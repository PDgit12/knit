import { useEffect, useState } from 'react';
import { api, type ProjectMetrics } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import {
  Card, Eyebrow, HeroNumber, StatNumber, DeltaPill, ArrowUpRight,
  Loading, ErrorBanner,
} from '../components/Card';

const VERDICT_META: Record<ProjectMetrics['verdict'], { label: string; variant: 'mint' | 'lavender' | 'neutral' | 'dark'; hint: string }> = {
  cold:        { label: 'Cold',        variant: 'neutral',  hint: 'Fewer than 3 sessions. Memory layer is establishing baseline.' },
  warming:     { label: 'Warming',     variant: 'lavender', hint: 'Below 50% reuse or fewer than 10 cache hits.' },
  compounding: { label: 'Compounding', variant: 'mint',     hint: 'Cache hits accumulating. Memory paying back per-session overhead.' },
  strong:      { label: 'Strong',      variant: 'dark',     hint: '50%+ reuse AND 10+ cache hits. Memory is load-bearing.' },
};

const TIER_COST: Record<string, number> = { inquiry: 200, trivial: 1500, standard: 8000, complex: 25000 };
const TIER_COLOR: Record<string, string> = {
  inquiry:  'var(--surface-glass)',
  trivial:  'var(--surface-mint)',
  standard: 'var(--surface-lavender)',
  complex:  'var(--surface-dark)',
};

export function MetricsView({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useBrainSync();

  useEffect(() => {
    api.projectMetrics(projectId)
      .then((m) => { setMetrics(m); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [projectId, sync.tick]);

  if (error) return <ErrorBanner message={error} />;
  if (!metrics) return <Loading />;

  const verdict = VERDICT_META[metrics.verdict];
  const netPositive = metrics.netTokenDelta >= 0;
  const netDisplay = formatTokens(Math.abs(metrics.netTokenDelta));

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <a href={`#/p/${projectId}`} style={{
          color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)',
          fontWeight: 'var(--weight-medium)',
        }}>← {metrics.projectName}</a>
        <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: 0, letterSpacing: '-0.01em' }}>
          Compounding ROI
        </h1>
      </div>

      {/* Hero verdict + net delta */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 8' }}>
          <Card variant={verdict.variant} padding="large" style={{ minHeight: 280 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <Eyebrow>Net tokens · est.</Eyebrow>
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <HeroNumber>{(netPositive ? '+' : '−') + netDisplay}</HeroNumber>
                </div>
                <div style={{
                  marginTop: 'var(--space-3)',
                  fontSize: 'var(--size-label)',
                  color: verdict.variant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
                }}>
                  {formatTokens(metrics.tokensSavedEstimate)} saved · {formatTokens(metrics.tokensSpentEstimate)} spent
                </div>
              </div>
              <DeltaPill value={verdict.label} positive={netPositive} />
            </div>

            <div style={{ marginTop: 'var(--space-6)' }}>
              <Eyebrow style={{ color: verdict.variant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)' }}>
                Verdict
              </Eyebrow>
              <p style={{
                margin: '6px 0 0',
                color: verdict.variant === 'dark' ? 'var(--text-light)' : 'var(--text-dark)',
                fontSize: 'var(--size-body)', lineHeight: 1.55,
              }}>
                {verdict.hint}
              </p>
            </div>

            <SavedVsSpentRibbon
              saved={metrics.tokensSavedEstimate}
              spent={metrics.tokensSpentEstimate}
              onDark={verdict.variant === 'dark'}
            />
          </Card>
        </div>

        <div style={{ gridColumn: 'span 4', display: 'grid', gap: 'var(--space-4)' }}>
          <Card variant="mint" padding="normal" style={{ minHeight: 130 }}>
            <Eyebrow>Reuse ratio</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <StatNumber>{metrics.totalSessions > 0 ? Math.min(100, Math.round((metrics.cacheHits / metrics.totalSessions) * 100)) : 0}</StatNumber>
              <span style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-medium)', color: 'var(--text-mute-dark)' }}>%</span>
              <ArrowUpRight size={14} />
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
              {metrics.cacheHits} hits / {metrics.totalSessions} sessions
            </div>
          </Card>
          <Card variant="lavender" padding="normal" style={{ minHeight: 130 }}>
            <Eyebrow>Plan-mode triggers</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <StatNumber>{metrics.planModeTriggers}</StatNumber>
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
              of {metrics.totalClassifications} classifications
            </div>
          </Card>
        </div>
      </div>

      {/* Classification + retrieval breakdowns */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 7' }}>
          <Card variant="neutral" padding="normal">
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <div>
                <Eyebrow>Classifications by tier</Eyebrow>
                <div style={{ marginTop: 4, fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>
                  Where tokens were spent
                </div>
              </div>
              <span style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
                {metrics.totalClassifications} total
              </span>
            </div>
            <ClassificationBars classifications={metrics.classificationsByTier} total={metrics.totalClassifications} />
          </Card>
        </div>

        <div style={{ gridColumn: 'span 5' }}>
          <Card variant="neutral" padding="normal">
            <Eyebrow>Retrieval signals</Eyebrow>
            <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 'var(--space-3)' }}>
              <RetrievalRow
                label="Cache hits" value={metrics.cacheHits}
                tokensSaved={metrics.cacheHits * 15000}
                color="var(--surface-mint)"
              />
              <RetrievalRow
                label="Graph queries" value={metrics.graphQueries}
                tokensSaved={metrics.graphQueries * 3000}
                color="var(--surface-lavender)"
              />
              <RetrievalRow
                label="FP suppressions" value={metrics.fpSuppressions}
                tokensSaved={metrics.fpSuppressions * 5000}
                color="var(--surface-dark)"
              />
              <RetrievalRow
                label="High-score hits" value={metrics.highScoreHits}
                hint="BM25 > 5.0"
                color="var(--text-mute-dark)"
              />
              <RetrievalRow
                label="Total queries" value={metrics.totalRetrievalQueries}
                hint="incl. zero-hit"
                color="var(--text-mute-dark)"
              />
              <RetrievalRow
                label="Learnings accessed" value={`${metrics.accessedLearnings}/${metrics.totalLearnings}`}
                hint={`${metrics.accessedPct}% of corpus`}
                color="var(--text-mute-dark)"
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Domain coverage */}
      {Object.keys(metrics.domainDistribution).length > 0 && (
        <Card variant="neutral" padding="normal">
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
            <Eyebrow>Top domains</Eyebrow>
            <span style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
              where the brain has deepest coverage
            </span>
          </div>
          <DomainBars distribution={metrics.domainDistribution} />
        </Card>
      )}
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────

function SavedVsSpentRibbon({ saved, spent, onDark }: { saved: number; spent: number; onDark: boolean }) {
  const total = Math.max(saved + spent, 1);
  const savedPct = (saved / total) * 100;
  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        marginBottom: 8, fontSize: 'var(--size-eyebrow)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: onDark ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
      }}>
        <span>Saved {savedPct.toFixed(0)}%</span>
        <span>Spent {(100 - savedPct).toFixed(0)}%</span>
      </div>
      <div style={{
        height: 12, borderRadius: 999, overflow: 'hidden',
        background: onDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(13, 13, 13, 0.08)',
        display: 'flex',
      }}>
        <div style={{ width: `${savedPct}%`, background: onDark ? 'var(--surface-mint)' : 'var(--surface-dark)' }} />
        <div style={{ flex: 1, background: 'var(--surface-lavender)', opacity: 0.5 }} />
      </div>
    </div>
  );
}

function ClassificationBars({ classifications, total }: { classifications: Record<string, number>; total: number }) {
  const tiers: Array<{ key: 'inquiry' | 'trivial' | 'standard' | 'complex'; label: string }> = [
    { key: 'inquiry',  label: 'Inquiry (read-only)' },
    { key: 'trivial',  label: 'Trivial' },
    { key: 'standard', label: 'Standard' },
    { key: 'complex',  label: 'Complex' },
  ];
  return (
    <div style={{ display: 'grid', gap: 'var(--space-3)', marginTop: 'var(--space-4)' }}>
      {tiers.map((tier) => {
        const count = classifications[tier.key] ?? 0;
        const pct = total > 0 ? (count / total) * 100 : 0;
        const cost = TIER_COST[tier.key];
        return (
          <div key={tier.key}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
              fontSize: 'var(--size-label)', marginBottom: 6,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 4,
                  background: TIER_COLOR[tier.key],
                  border: tier.key === 'inquiry' ? '1px solid var(--hairline)' : 'none',
                }} />
                <span style={{ fontWeight: 'var(--weight-medium)' }}>{tier.label}</span>
                <span className="tabular" style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-eyebrow)' }}>
                  {cost.toLocaleString()} tok
                </span>
              </div>
              <span className="tabular" style={{ fontWeight: 'var(--weight-semibold)' }}>
                {count}
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-glass)', borderRadius: 999, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: TIER_COLOR[tier.key] }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RetrievalRow({ label, value, hint, color, tokensSaved }: {
  label: string;
  value: number | string;
  hint?: string;
  color: string;
  tokensSaved?: number;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 'var(--space-3)', padding: '8px 0',
      borderBottom: '1px solid var(--hairline)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: color, flexShrink: 0 }} />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 'var(--size-label)', fontWeight: 'var(--weight-medium)' }}>{label}</div>
          {hint && <div style={{ fontSize: 'var(--size-eyebrow)', color: 'var(--text-mute-dark)', marginTop: 2 }}>{hint}</div>}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="tabular" style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)' }}>
          {value}
        </div>
        {tokensSaved !== undefined && tokensSaved > 0 && (
          <div className="tabular" style={{ fontSize: 'var(--size-eyebrow)', color: 'var(--text-mute-dark)', marginTop: 2 }}>
            +{formatTokens(tokensSaved)} saved
          </div>
        )}
      </div>
    </div>
  );
}

function DomainBars({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, c]) => c));
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {entries.map(([domain, count]) => (
        <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 160, flexShrink: 0, fontSize: 'var(--size-label)',
            color: 'var(--text-mute-dark)', textAlign: 'right',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>{domain}</div>
          <div style={{ flex: 1, height: 10, background: 'var(--surface-glass)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${(count / max) * 100}%`, height: '100%',
              background: 'var(--surface-lavender)',
            }} />
          </div>
          <div className="tabular" style={{
            width: 40, textAlign: 'right',
            fontSize: 'var(--size-label)', fontWeight: 'var(--weight-medium)',
          }}>{count}</div>
        </div>
      ))}
    </div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
