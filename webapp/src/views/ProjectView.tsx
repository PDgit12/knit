import { useEffect, useMemo, useState } from 'react';
import { api, type LearningEntry, type ProjectMetrics } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import {
  Card, Eyebrow, HeroNumber, StatNumber, DeltaPill, ArrowUpRight,
  Loading, ErrorBanner,
} from '../components/Card';

const VERDICT_TONE: Record<ProjectMetrics['verdict'], 'mint' | 'lavender' | 'neutral' | 'dark'> = {
  cold: 'neutral',
  warming: 'lavender',
  compounding: 'mint',
  strong: 'dark',
};

export function ProjectView({ projectId }: { projectId: string }) {
  const [name, setName] = useState<string>('');
  const [learnings, setLearnings] = useState<LearningEntry[] | null>(null);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const sync = useBrainSync();

  useEffect(() => {
    Promise.all([api.projectLearnings(projectId), api.projectMetrics(projectId)])
      .then(([l, m]) => { setName(l.project.name); setLearnings(l.learnings); setMetrics(m); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [projectId, sync.tick]);

  const filtered = useMemo(() => {
    if (!learnings) return [];
    if (!query.trim()) return learnings;
    const q = query.toLowerCase();
    return learnings.filter((l) =>
      l.summary.toLowerCase().includes(q) ||
      l.lesson.toLowerCase().includes(q) ||
      l.tags.some((t) => t.toLowerCase().includes(q)) ||
      l.domains.some((d) => d.toLowerCase().includes(q))
    );
  }, [learnings, query]);

  if (error) return <ErrorBanner message={error} />;
  if (!metrics || !learnings) return <Loading />;

  const netDisplay = formatTokens(Math.abs(metrics.netTokenDelta));
  const netPositive = metrics.netTokenDelta >= 0;
  const verdictVariant = VERDICT_TONE[metrics.verdict];

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {/* Header strip — back link + project name + verdict pill */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-1)' }}>
        <a href="#/" style={{
          color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)',
          fontWeight: 'var(--weight-medium)',
        }}>← Brain</a>
        <h1 style={{
          fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)',
          margin: 0, letterSpacing: '-0.01em',
        }}>{name}</h1>
        <VerdictPill verdict={metrics.verdict} />
      </div>

      {/* Top row: hero net-tokens + retrieval stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 7' }}>
          <Card variant={verdictVariant} padding="large" style={{ minHeight: 240 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <Eyebrow>Net tokens · this project</Eyebrow>
              <DeltaPill value={`${netPositive ? '+' : '−'}${netDisplay}`} positive={netPositive} />
            </div>
            <div style={{ marginTop: 'var(--space-6)' }}>
              <HeroNumber>{(netPositive ? '+' : '−') + netDisplay}</HeroNumber>
              <div style={{
                marginTop: 'var(--space-2)',
                fontSize: 'var(--size-label)',
                color: verdictVariant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
              }}>
                {formatTokens(metrics.tokensSavedEstimate)} saved · {formatTokens(metrics.tokensSpentEstimate)} spent
                · {metrics.totalSessions} session{metrics.totalSessions === 1 ? '' : 's'}
              </div>
            </div>
            <SavedSpentBar
              saved={metrics.tokensSavedEstimate}
              spent={metrics.tokensSpentEstimate}
              onDark={verdictVariant === 'dark'}
            />
          </Card>
        </div>

        <div style={{ gridColumn: 'span 5', display: 'grid', gap: 'var(--space-4)' }}>
          <Card variant="neutral" padding="normal">
            <Eyebrow>Retrieval signals</Eyebrow>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 'var(--space-4)', marginTop: 'var(--space-4)',
            }}>
              <MiniStat label="Cache hits" value={metrics.cacheHits} hint={`${(metrics.cacheHits * 15).toLocaleString()}K saved`} />
              <MiniStat label="Graph queries" value={metrics.graphQueries} hint={`${(metrics.graphQueries * 3).toLocaleString()}K saved`} />
              <MiniStat label="FP suppressions" value={metrics.fpSuppressions} hint={`${(metrics.fpSuppressions * 5).toLocaleString()}K saved`} />
              <MiniStat label="High-score hits" value={metrics.highScoreHits} hint="BM25 > 5.0" />
            </div>
          </Card>
          <a href={`#/p/${projectId}/metrics`} style={{ textDecoration: 'none' }}>
            <Card variant="mint" padding="normal" onClick={() => { /* navigated via href */ }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <Eyebrow>See full ROI breakdown</Eyebrow>
                  <div style={{ marginTop: 4, fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>
                    Compounding analysis
                  </div>
                </div>
                <ArrowUpRight size={18} />
              </div>
            </Card>
          </a>
        </div>
      </div>

      {/* Learnings list — searchable */}
      <Card variant="neutral" padding="normal">
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 'var(--space-4)', gap: 'var(--space-3)',
        }}>
          <div>
            <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>
              Learnings
            </div>
            <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', marginTop: 2 }}>
              {filtered.length}{query && ` of ${learnings.length}`} entries · {metrics.accessedPct}% accessed
            </div>
          </div>
          <SearchInput value={query} onChange={setQuery} />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {filtered.map((entry) => (
            <LearningRow key={entry.id} entry={entry} />
          ))}
          {filtered.length === 0 && (
            <Card variant="glass" radius="inner" padding="normal">
              <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
                {query ? `No learnings match "${query}".` : 'No learnings recorded for this project yet.'}
              </div>
            </Card>
          )}
        </div>
      </Card>

      {/* Domain coverage */}
      {Object.keys(metrics.domainDistribution).length > 0 && (
        <Card variant="neutral" padding="normal">
          <Eyebrow>Top domains</Eyebrow>
          <DomainBars distribution={metrics.domainDistribution} />
        </Card>
      )}
    </div>
  );
}

// ─── Components ─────────────────────────────────────────────────────────

function VerdictPill({ verdict }: { verdict: ProjectMetrics['verdict'] }) {
  const bg = {
    cold: 'var(--surface-glass)',
    warming: 'var(--surface-lavender)',
    compounding: 'var(--surface-mint)',
    strong: 'var(--surface-dark)',
  }[verdict];
  const fg = verdict === 'strong' ? 'var(--text-light)' : 'var(--text-dark)';
  return (
    <span style={{
      marginLeft: 'auto',
      background: bg, color: fg,
      padding: '6px 14px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 'var(--size-label)',
      fontWeight: 'var(--weight-semibold)',
      textTransform: 'capitalize',
    }}>{verdict}</span>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute-dark)', marginBottom: 4 }}>
        {label}
      </div>
      <StatNumber>{value}</StatNumber>
      {hint && (
        <div style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)', marginTop: 4 }}>{hint}</div>
      )}
    </div>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search summary, lesson, tags, domains…"
      style={{
        background: 'var(--surface-glass)',
        border: '1px solid var(--hairline)',
        color: 'var(--text-dark)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-pill)',
        width: 320,
        maxWidth: '50vw',
        fontSize: 'var(--size-label)',
        fontFamily: 'var(--font-sans)',
        outline: 'none',
      }}
    />
  );
}

function LearningRow({ entry }: { entry: LearningEntry }) {
  return (
    <Card variant="glass" radius="inner" padding="normal">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-body)', marginBottom: 6 }}>
            {entry.summary}
          </div>
          {entry.lesson && (
            <p style={{
              margin: 0, color: 'var(--text-mute-dark)', lineHeight: 1.55,
              fontSize: 'var(--size-label)',
            }}>
              {entry.lesson.length > 280 ? entry.lesson.slice(0, 280) + '…' : entry.lesson}
            </p>
          )}
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {entry.domains.map((d) => (
              <Chip key={d} variant="solid">{d}</Chip>
            ))}
            {entry.tags.slice(0, 5).map((t) => (
              <Chip key={t} variant="ghost">{t}</Chip>
            ))}
          </div>
        </div>
        <div style={{
          color: 'var(--text-mute-dark)', fontSize: 'var(--size-eyebrow)',
          textAlign: 'right', flexShrink: 0,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          <div>{entry.date}</div>
          <div style={{ marginTop: 4 }}>×{entry.accessCount}</div>
        </div>
      </div>
    </Card>
  );
}

function Chip({ children, variant }: { children: React.ReactNode; variant: 'solid' | 'ghost' }) {
  return (
    <span style={{
      padding: '3px 10px',
      background: variant === 'solid' ? 'var(--surface-mint)' : 'transparent',
      color: variant === 'solid' ? 'var(--text-dark)' : 'var(--text-mute-dark)',
      border: variant === 'ghost' ? '1px solid var(--hairline)' : 'none',
      borderRadius: 'var(--radius-pill)',
      fontSize: 'var(--size-eyebrow)',
      fontWeight: 'var(--weight-medium)',
    }}>{children}</span>
  );
}

function SavedSpentBar({ saved, spent, onDark }: { saved: number; spent: number; onDark: boolean }) {
  const total = Math.max(saved + spent, 1);
  const savedPct = (saved / total) * 100;
  return (
    <div style={{ marginTop: 'var(--space-6)' }}>
      <div style={{
        height: 10, borderRadius: 999, overflow: 'hidden',
        background: onDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(13, 13, 13, 0.08)',
        display: 'flex',
      }}>
        <div style={{
          width: `${savedPct}%`,
          background: onDark ? 'var(--surface-mint)' : 'var(--surface-dark)',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between', marginTop: 6,
        fontSize: 'var(--size-eyebrow)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
        color: onDark ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
      }}>
        <span>Saved {savedPct.toFixed(0)}%</span>
        <span>Spent {(100 - savedPct).toFixed(0)}%</span>
      </div>
    </div>
  );
}

function DomainBars({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map(([, c]) => c));
  return (
    <div style={{ display: 'grid', gap: 8, marginTop: 'var(--space-3)' }}>
      {entries.map(([domain, count]) => (
        <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <div style={{
            width: 140, flexShrink: 0, fontSize: 'var(--size-label)',
            color: 'var(--text-mute-dark)', textAlign: 'right',
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>{domain}</div>
          <div style={{ flex: 1, height: 8, background: 'var(--surface-glass)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{
              width: `${(count / max) * 100}%`, height: '100%',
              background: 'var(--surface-lavender)',
              borderRadius: 999,
            }} />
          </div>
          <div className="tabular" style={{
            width: 36, textAlign: 'right',
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
