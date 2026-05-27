import { useEffect, useState } from 'react';
import { api, type BrainSummary, type ProjectSummary } from '../api/client';
import { Card, Stat, Loading, ErrorBanner } from '../components/Card';

export function HomeView() {
  const [summary, setSummary] = useState<BrainSummary | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.brainSummary(), api.projects()])
      .then(([s, p]) => { setSummary(s); setProjects(p.projects); })
      .catch((err: Error) => setError(err.message));
  }, []);

  return (
    <>
      <header style={{ marginBottom: '2rem' }}>
        <h1 style={{
          fontSize: '2rem', fontWeight: 600, margin: 0,
          background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Brain — all projects
        </h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem' }}>
          Local-first analytics on top of <code>~/.knit/</code>.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {!summary && !error && <Loading />}

      {summary && (
        <section style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem',
          marginBottom: '2.5rem',
        }}>
          <Stat label="Projects" value={summary.projectCount} />
          <Stat label="Project learnings" value={summary.totalLearnings} />
          <Stat label="Global learnings" value={summary.globalLearnings} hint="Cross-project pool" />
          <Stat label="Knit version" value={summary.knitVersion} mono />
        </section>
      )}

      {projects && projects.length > 0 && (
        <section>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1rem' }}>Projects</h2>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {projects.map((p) => (
              <a key={p.id} href={`#/p/${p.id}`} style={{ textDecoration: 'none' }}>
                <Card style={{ cursor: 'pointer', transition: 'border-color 150ms' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--text)' }}>{p.name}</div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                        <code>{p.id}</code>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
                      <div>{p.learningCount} learning{p.learningCount === 1 ? '' : 's'}</div>
                      <div>{p.sessionCount} session{p.sessionCount === 1 ? '' : 's'}</div>
                      {p.lastActive && <div style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>last: {p.lastActive}</div>}
                    </div>
                  </div>
                </Card>
              </a>
            ))}
          </div>
        </section>
      )}

      {projects && projects.length === 0 && (
        <Card>
          <p style={{ margin: 0, color: 'var(--text-dim)' }}>
            No projects yet. The brain initializes on the first MCP call from a Claude Code (or Cursor / Codex / Cline / Continue) session.
          </p>
        </Card>
      )}

      {summary && (
        <footer style={{ marginTop: '3rem', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
          Reading from <code>{summary.knitHome}</code>
        </footer>
      )}
    </>
  );
}
