import { useEffect, useMemo, useState } from 'react';
import { api, type GlobalLearning } from '../api/client';
import { Card, Loading, ErrorBanner } from '../components/Card';

export function GlobalView() {
  const [learnings, setLearnings] = useState<GlobalLearning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');

  useEffect(() => {
    api.globalLearnings()
      .then((r) => setLearnings(r.learnings))
      .catch((err: Error) => setError(err.message));
  }, []);

  const filtered = useMemo(() => {
    if (!learnings) return [];
    if (!query.trim()) return learnings;
    const q = query.toLowerCase();
    return learnings.filter((l) =>
      l.summary.toLowerCase().includes(q) ||
      l.lesson.toLowerCase().includes(q) ||
      l.tags.some((t) => t.toLowerCase().includes(q)) ||
      l.sourceProjectName.toLowerCase().includes(q)
    );
  }, [learnings, query]);

  const byProject = useMemo(() => {
    const grouped: Record<string, number> = {};
    if (!learnings) return grouped;
    for (const l of learnings) grouped[l.sourceProjectName] = (grouped[l.sourceProjectName] ?? 0) + 1;
    return grouped;
  }, [learnings]);

  return (
    <>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Cross-project learnings</h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          The global pool — patterns that generalize across projects. Stored at <code>~/.knit/global/learnings.jsonl</code>.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {!learnings && !error && <Loading />}

      {learnings && (
        <>
          {Object.keys(byProject).length > 1 && (
            <Card style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: '0.5rem' }}>
                Contributing projects
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {Object.entries(byProject).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                  <span key={name} style={{
                    padding: '0.25rem 0.625rem', background: 'var(--bg)', border: '1px solid var(--border)',
                    borderRadius: 999, fontSize: '0.8125rem',
                  }}>
                    {name} <span style={{ color: 'var(--text-dim)' }}>×{count}</span>
                  </span>
                ))}
              </div>
            </Card>
          )}

          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '1rem', gap: '1rem' }}>
            <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              {filtered.length}{query && ` of ${learnings.length}`} learning{filtered.length === 1 ? '' : 's'}
            </div>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search summary, lesson, tags, project…"
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
                padding: '0.5rem 0.75rem', borderRadius: 8, width: 320, fontSize: '0.875rem',
              }}
            />
          </div>

          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {filtered.map((l) => (
              <Card key={l.id}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem' }}>
                  <div style={{ fontWeight: 600 }}>{l.summary}</div>
                  <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', flexShrink: 0 }}>
                    {l.date}
                  </div>
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                  from <strong style={{ color: 'var(--text)' }}>{l.sourceProjectName}</strong>
                </div>
                {l.lesson && (
                  <p style={{ margin: '0.75rem 0 0', color: 'var(--text)', lineHeight: 1.6, fontSize: '0.9375rem' }}>
                    {l.lesson.length > 400 ? l.lesson.slice(0, 400) + '…' : l.lesson}
                  </p>
                )}
                <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  {l.tags.slice(0, 8).map((t) => (
                    <span key={t} style={{
                      padding: '0.125rem 0.5rem', color: 'var(--accent)', fontSize: '0.75rem',
                    }}>{t}</span>
                  ))}
                </div>
              </Card>
            ))}
            {filtered.length === 0 && (
              <Card>
                <p style={{ margin: 0, color: 'var(--text-dim)' }}>
                  {query
                    ? `No global learnings match "${query}".`
                    : 'No cross-project learnings yet. Record one with knit_record_global_learning when a pattern repeats across projects.'}
                </p>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
