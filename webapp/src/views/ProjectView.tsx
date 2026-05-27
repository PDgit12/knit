import { useEffect, useMemo, useState } from 'react';
import { api, type LearningEntry, type ProjectMetrics } from '../api/client';
import { Card, Stat, Loading, ErrorBanner } from '../components/Card';

export function ProjectView({ projectId }: { projectId: string }) {
  const [projectName, setProjectName] = useState<string>('');
  const [learnings, setLearnings] = useState<LearningEntry[] | null>(null);
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');

  useEffect(() => {
    Promise.all([api.projectLearnings(projectId), api.projectMetrics(projectId)])
      .then(([l, m]) => { setProjectName(l.project.name); setLearnings(l.learnings); setMetrics(m); })
      .catch((err: Error) => setError(err.message));
  }, [projectId]);

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

  return (
    <>
      <header style={{ marginBottom: '2rem' }}>
        <a href="#/" style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>← All projects</a>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: '0.5rem 0 0' }}>{projectName || projectId}</h1>
        <code style={{ color: 'var(--text-dim)', fontSize: '0.75rem' }}>{projectId}</code>
      </header>

      {error && <ErrorBanner message={error} />}
      {!metrics && !error && <Loading />}

      {metrics && (
        <section style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem',
          marginBottom: '2rem',
        }}>
          <Stat label="Sessions" value={metrics.totalSessions} />
          <Stat label="Learnings" value={metrics.totalLearnings} hint={`${metrics.accessedPct}% accessed`} />
          <Stat label="Cache hits" value={metrics.cacheHits} hint="Memory paid back" />
          <Stat
            label="Net tokens"
            value={formatTokens(metrics.netTokenDelta)}
            hint={metrics.verdict}
          />
        </section>
      )}

      {metrics && (
        <div style={{ marginBottom: '2rem' }}>
          <a href={`#/p/${projectId}/metrics`} style={{ color: 'var(--accent)', fontSize: '0.875rem' }}>
            See full ROI breakdown →
          </a>
        </div>
      )}

      {learnings && (
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600, margin: 0 }}>
              Learnings <span style={{ color: 'var(--text-dim)', fontWeight: 400 }}>({filtered.length}{query && ` of ${learnings.length}`})</span>
            </h2>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search summary, lesson, tags, domains…"
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                padding: '0.5rem 0.75rem',
                borderRadius: 8,
                width: 320,
                fontSize: '0.875rem',
              }}
            />
          </div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {filtered.map((entry) => (
              <Card key={entry.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
                  <div style={{ fontWeight: 600 }}>{entry.summary}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', flexShrink: 0 }}>
                    {entry.date} · accessed {entry.accessCount}×
                  </div>
                </div>
                {entry.lesson && (
                  <p style={{ margin: '0.75rem 0 0', color: 'var(--text)', lineHeight: 1.6, fontSize: '0.9375rem' }}>
                    {entry.lesson.length > 400 ? entry.lesson.slice(0, 400) + '…' : entry.lesson}
                  </p>
                )}
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {entry.domains.map((d) => (
                    <span key={d} style={{
                      padding: '0.125rem 0.5rem', background: 'var(--bg)', border: '1px solid var(--border)',
                      borderRadius: 999, fontSize: '0.75rem', color: 'var(--text-dim)',
                    }}>{d}</span>
                  ))}
                  {entry.tags.slice(0, 6).map((t) => (
                    <span key={t} style={{
                      padding: '0.125rem 0.5rem', background: 'transparent', border: '1px solid transparent',
                      color: 'var(--accent)', fontSize: '0.75rem',
                    }}>{t}</span>
                  ))}
                </div>
              </Card>
            ))}
            {filtered.length === 0 && (
              <Card>
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>
                  {query ? `No learnings match "${query}".` : 'No learnings yet for this project.'}
                </p>
              </Card>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function formatTokens(n: number): string {
  const sign = n >= 0 ? '+' : '−';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}
