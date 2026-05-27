import { useEffect, useState } from 'react';
import { api, type ProjectMetrics } from '../api/client';
import { Card, Stat, Loading, ErrorBanner } from '../components/Card';

const VERDICT_COPY: Record<ProjectMetrics['verdict'], { label: string; color: string; hint: string }> = {
  cold: { label: 'Cold', color: '#8a9098', hint: 'Less than 3 sessions — too early to measure.' },
  warming: { label: 'Warming', color: '#eab308', hint: 'Below 50% reuse OR fewer than 10 cache hits.' },
  compounding: { label: 'Compounding', color: '#2563eb', hint: 'Cache hits accumulating; memory paying back.' },
  strong: { label: 'Strong', color: '#7c3aed', hint: '50%+ reuse AND 10+ cache hits. Memory is load-bearing.' },
};

export function MetricsView({ projectId }: { projectId: string }) {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.projectMetrics(projectId)
      .then(setMetrics)
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

  return (
    <>
      <header style={{ marginBottom: '2rem' }}>
        <a href={`#/p/${projectId}`} style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>← {metrics?.projectName || 'Project'}</a>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0.5rem 0 0' }}>Compounding ROI</h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Token economics estimate. Multipliers in sync with <code>src/mcp/handlers.ts</code>:
          cacheHits × 15K + fpSuppressions × 5K + graphQueries × 3K = tokens saved.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {!metrics && !error && <Loading />}

      {metrics && (
        <>
          <VerdictBanner verdict={metrics.verdict} />

          <section style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem',
            marginTop: '2rem', marginBottom: '2rem',
          }}>
            <Stat label="Tokens saved" value={formatK(metrics.tokensSavedEstimate)} hint="Estimate" />
            <Stat label="Tokens spent" value={formatK(metrics.tokensSpentEstimate)} hint="Classification cost" />
            <Stat
              label="Net delta"
              value={(metrics.netTokenDelta >= 0 ? '+' : '−') + formatK(Math.abs(metrics.netTokenDelta))}
              hint={metrics.netTokenDelta >= 0 ? 'Paying back' : 'Not yet recovered'}
            />
            <Stat label="Reuse cache hits" value={metrics.cacheHits} />
          </section>

          <TokenBar saved={metrics.tokensSavedEstimate} spent={metrics.tokensSpentEstimate} />

          <section style={{ marginTop: '2.5rem', display: 'grid', gap: '1.5rem' }}>
            <ClassificationBreakdown classifications={metrics.classificationsByTier} planModeTriggers={metrics.planModeTriggers} />
            <RetrievalBreakdown
              cacheHits={metrics.cacheHits}
              graphQueries={metrics.graphQueries}
              fpSuppressions={metrics.fpSuppressions}
              highScoreHits={metrics.highScoreHits}
              totalRetrievalQueries={metrics.totalRetrievalQueries}
              accessedLearnings={metrics.accessedLearnings}
              totalLearnings={metrics.totalLearnings}
              accessedPct={metrics.accessedPct}
            />
            <DomainDistribution distribution={metrics.domainDistribution} />
          </section>
        </>
      )}
    </>
  );
}

function VerdictBanner({ verdict }: { verdict: ProjectMetrics['verdict'] }) {
  const v = VERDICT_COPY[verdict];
  return (
    <Card style={{ borderColor: v.color }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '1rem' }}>
        <div style={{
          width: 8, height: 8, borderRadius: 999, background: v.color, flexShrink: 0,
          alignSelf: 'center',
        }} />
        <div>
          <div style={{ fontWeight: 600, fontSize: '1.125rem', color: v.color }}>{v.label}</div>
          <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginTop: '0.25rem' }}>{v.hint}</div>
        </div>
      </div>
    </Card>
  );
}

function TokenBar({ saved, spent }: { saved: number; spent: number }) {
  const total = Math.max(saved + spent, 1);
  const savedPct = (saved / total) * 100;
  const spentPct = (spent / total) * 100;
  return (
    <Card>
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '0.75rem' }}>
        Saved vs spent
      </div>
      <div style={{
        display: 'flex', height: 24, borderRadius: 6, overflow: 'hidden',
        background: 'var(--bg)', border: '1px solid var(--border)',
      }}>
        <div style={{ width: `${savedPct}%`, background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
        <div style={{ width: `${spentPct}%`, background: '#3a3f48' }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
        <span><span style={{ color: 'var(--accent)' }}>■</span> Saved {formatK(saved)}</span>
        <span>Spent {formatK(spent)} <span style={{ color: '#3a3f48' }}>■</span></span>
      </div>
    </Card>
  );
}

function ClassificationBreakdown({
  classifications, planModeTriggers,
}: { classifications: Record<string, number>; planModeTriggers: number }) {
  const total = Object.values(classifications).reduce((a, b) => a + b, 0);
  const tiers: Array<{ key: string; label: string; cost: number }> = [
    { key: 'inquiry', label: 'Inquiry (read-only)', cost: 200 },
    { key: 'trivial', label: 'Trivial', cost: 1500 },
    { key: 'standard', label: 'Standard', cost: 8000 },
    { key: 'complex', label: 'Complex', cost: 25000 },
  ];
  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Classifications by tier</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', margin: '0.25rem 0 1rem' }}>
        {total} classifications · {planModeTriggers} plan-mode triggers
      </p>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {tiers.map((tier) => {
          const count = classifications[tier.key] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          return (
            <div key={tier.key}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', marginBottom: '0.25rem' }}>
                <span>{tier.label} <span style={{ color: 'var(--text-dim)' }}>({tier.cost.toLocaleString()} tok each)</span></span>
                <span style={{ color: 'var(--text-dim)' }}>{count}</span>
              </div>
              <div style={{ height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${pct}%`, height: '100%',
                  background: tier.key === 'complex' ? '#7c3aed' : tier.key === 'standard' ? '#2563eb' : tier.key === 'trivial' ? '#06b6d4' : '#3a3f48',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function RetrievalBreakdown(props: {
  cacheHits: number; graphQueries: number; fpSuppressions: number;
  highScoreHits: number; totalRetrievalQueries: number;
  accessedLearnings: number; totalLearnings: number; accessedPct: number;
}) {
  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Retrieval activity</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', margin: '0.25rem 0 1rem' }}>
        How often the brain answered instead of re-investigating.
      </p>
      <dl style={{
        display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', margin: 0,
        fontSize: '0.875rem',
      }}>
        <dt style={{ color: 'var(--text-dim)' }}>Retrieval queries</dt>
        <dd style={{ margin: 0 }}>{props.totalRetrievalQueries}</dd>
        <dt style={{ color: 'var(--text-dim)' }}>High-score hits (BM25 &gt; 5.0)</dt>
        <dd style={{ margin: 0 }}>{props.highScoreHits}</dd>
        <dt style={{ color: 'var(--text-dim)' }}>Graph-traversal queries</dt>
        <dd style={{ margin: 0 }}>{props.graphQueries} <span style={{ color: 'var(--text-dim)' }}>(× 3K = {(props.graphQueries * 3000).toLocaleString()} tok saved)</span></dd>
        <dt style={{ color: 'var(--text-dim)' }}>FP suppressions</dt>
        <dd style={{ margin: 0 }}>{props.fpSuppressions} <span style={{ color: 'var(--text-dim)' }}>(× 5K = {(props.fpSuppressions * 5000).toLocaleString()} tok saved)</span></dd>
        <dt style={{ color: 'var(--text-dim)' }}>Cache hits</dt>
        <dd style={{ margin: 0 }}>{props.cacheHits} <span style={{ color: 'var(--text-dim)' }}>(× 15K = {(props.cacheHits * 15000).toLocaleString()} tok saved)</span></dd>
        <dt style={{ color: 'var(--text-dim)' }}>Entries accessed</dt>
        <dd style={{ margin: 0 }}>{props.accessedLearnings} of {props.totalLearnings} ({props.accessedPct}%)</dd>
      </dl>
    </Card>
  );
}

function DomainDistribution({ distribution }: { distribution: Record<string, number> }) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (entries.length === 0) return null;
  const max = Math.max(...entries.map((e) => e[1]));
  return (
    <Card>
      <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Top domains</h3>
      <p style={{ color: 'var(--text-dim)', fontSize: '0.8125rem', margin: '0.25rem 0 1rem' }}>
        Where the brain has the deepest coverage.
      </p>
      <div style={{ display: 'grid', gap: '0.375rem' }}>
        {entries.map(([domain, count]) => (
          <div key={domain} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div style={{
              fontSize: '0.8125rem', color: 'var(--text-dim)',
              flexShrink: 0, width: 120, textAlign: 'right',
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}>{domain}</div>
            <div style={{ flex: 1, height: 6, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${(count / max) * 100}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-dim)', flexShrink: 0, width: 30, textAlign: 'right' }}>{count}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function formatK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
