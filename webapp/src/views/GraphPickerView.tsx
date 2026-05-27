import { useEffect, useState } from 'react';
import { api, type ProjectSummary } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import { Card, Eyebrow, StatNumber, ArrowUpRight, Loading, ErrorBanner } from '../components/Card';

// #/graph — top-level Graph entry point. When there's exactly one
// project, jump straight into its brain graph. When there are several,
// show a picker with a per-project hint (learning count + last active).
// This keeps the graph as a first-class nav item without forcing users
// to drill through a specific project view first.

export function GraphPickerView() {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useBrainSync();

  useEffect(() => {
    api.projects()
      .then((r) => {
        setProjects(r.projects);
        setError(null);
        // Auto-jump for the single-project case so the user doesn't
        // have to click through a meaningless picker.
        if (r.projects.length === 1) {
          window.location.hash = `#/p/${r.projects[0].id}/graph`;
        }
      })
      .catch((err: Error) => setError(err.message));
  }, [sync.tick]);

  if (error) return <ErrorBanner message={error} />;
  if (!projects) return <Loading />;

  if (projects.length === 0) {
    return (
      <Card variant="neutral" padding="large">
        <Eyebrow>No projects yet</Eyebrow>
        <p style={{ marginTop: 'var(--space-3)', color: 'var(--text-mute-dark)', fontSize: 'var(--size-body)' }}>
          The brain graph visualizes relationships between recorded learnings. As soon as any agent records
          its first learning via <code>knit_record_learning</code>, that project will appear here with a
          clickable graph view.
        </p>
      </Card>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div>
        <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: 0, letterSpacing: '-0.01em' }}>
          Brain graph
        </h1>
        <p style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', margin: '4px 0 0' }}>
          Pick a project to visualize its memory as a force-directed graph of relationships.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--space-3)' }}>
        {projects.map((p) => (
          <a key={p.id} href={`#/p/${p.id}/graph`} style={{ textDecoration: 'none' }}>
            <Card variant="neutral" padding="normal" onClick={() => { /* navigated via href */ }} style={{ minHeight: 160, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <Eyebrow>Project</Eyebrow>
                <ArrowUpRight size={14} />
              </div>
              <div>
                <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.name}
                </div>
                <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
                  <div>
                    <StatNumber>{p.learningCount}</StatNumber>
                    <div style={{ fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute-dark)', marginTop: 2 }}>
                      learnings
                    </div>
                  </div>
                  <div>
                    <div className="tabular" style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>
                      {p.sessionCount}
                    </div>
                    <div style={{ fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute-dark)', marginTop: 2 }}>
                      sessions
                    </div>
                  </div>
                </div>
                {p.lastActive && (
                  <div style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)', marginTop: 'var(--space-3)' }}>
                    last active: <span className="tabular">{p.lastActive}</span>
                  </div>
                )}
              </div>
            </Card>
          </a>
        ))}
      </div>
    </div>
  );
}
