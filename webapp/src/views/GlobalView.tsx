import { useEffect, useMemo, useState } from 'react';
import { api, type GlobalLearning } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import {
  Card, Eyebrow, StatNumber, ArrowUpRight,
  Loading, ErrorBanner,
} from '../components/Card';

export function GlobalView() {
  const [learnings, setLearnings] = useState<GlobalLearning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const [activeProject, setActiveProject] = useState<string | null>(null);
  const sync = useBrainSync();

  useEffect(() => {
    api.globalLearnings()
      .then((r) => { setLearnings(r.learnings); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [sync.tick]);

  const filtered = useMemo(() => {
    if (!learnings) return [];
    const q = query.trim().toLowerCase();
    return learnings.filter((l) => {
      if (activeProject && l.sourceProjectName !== activeProject) return false;
      if (!q) return true;
      return (
        l.summary.toLowerCase().includes(q) ||
        l.lesson.toLowerCase().includes(q) ||
        l.tags.some((t) => t.toLowerCase().includes(q))
      );
    });
  }, [learnings, query, activeProject]);

  const byProject = useMemo(() => {
    const grouped: Record<string, number> = {};
    if (!learnings) return grouped;
    for (const l of learnings) grouped[l.sourceProjectName] = (grouped[l.sourceProjectName] ?? 0) + 1;
    return grouped;
  }, [learnings]);

  if (error) return <ErrorBanner message={error} />;
  if (!learnings) return <Loading />;

  const total = learnings.length;
  const projectCount = Object.keys(byProject).length;
  const topProjectName = Object.entries(byProject).sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: 0, letterSpacing: '-0.01em' }}>
            Cross-project pool
          </h1>
          <p style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', margin: '4px 0 0' }}>
            Patterns that generalize across projects · <code>~/.knit/global/learnings.jsonl</code>
          </p>
        </div>
        <SearchInput value={query} onChange={setQuery} />
      </div>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 4' }}>
          <Card variant="dark" padding="normal" style={{ minHeight: 140 }}>
            <Eyebrow style={{ color: 'var(--text-mute-light)' }}>Total entries</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <StatNumber>{total}</StatNumber>
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-light)' }}>
              spanning {projectCount} project{projectCount === 1 ? '' : 's'}
            </div>
          </Card>
        </div>
        <div style={{ gridColumn: 'span 4' }}>
          <Card variant="mint" padding="normal" style={{ minHeight: 140 }}>
            <Eyebrow>Top contributor</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--size-h2)', fontWeight: 'var(--weight-semibold)' }}>
              {topProjectName ?? '—'}
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
              {topProjectName ? `${byProject[topProjectName]} entries` : 'no contributors yet'}
            </div>
          </Card>
        </div>
        <div style={{ gridColumn: 'span 4' }}>
          <Card variant="lavender" padding="normal" style={{ minHeight: 140, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <Eyebrow>Active filter</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>
                {activeProject ?? 'All projects'}
              </div>
              <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
                {filtered.length} of {total} matching
              </div>
            </div>
            {activeProject && (
              <button
                type="button"
                onClick={() => setActiveProject(null)}
                style={{
                  alignSelf: 'flex-start', marginTop: 'var(--space-3)',
                  background: 'rgba(13, 13, 13, 0.08)', color: 'var(--text-dark)',
                  border: 'none', padding: '6px 12px', borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--size-label)', fontWeight: 'var(--weight-medium)',
                  cursor: 'pointer',
                }}
              >
                Clear filter
              </button>
            )}
          </Card>
        </div>
      </div>

      {/* Project filter chips */}
      {projectCount > 1 && (
        <Card variant="neutral" padding="normal">
          <Eyebrow>Filter by source project</Eyebrow>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
            {Object.entries(byProject).sort((a, b) => b[1] - a[1]).map(([name, count]) => {
              const active = activeProject === name;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => setActiveProject(active ? null : name)}
                  style={{
                    background: active ? 'var(--surface-dark)' : 'var(--surface-glass)',
                    color: active ? 'var(--text-light)' : 'var(--text-dark)',
                    border: active ? 'none' : '1px solid var(--hairline)',
                    padding: '7px 14px',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--size-label)', fontWeight: 'var(--weight-medium)',
                    cursor: 'pointer',
                    transition: 'background var(--duration-fast) var(--ease)',
                  }}
                >
                  {name}{' '}
                  <span className="tabular" style={{
                    color: active ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
                  }}>×{count}</span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Learnings feed */}
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {filtered.map((l) => (
          <GlobalLearningRow key={l.id} entry={l} />
        ))}
        {filtered.length === 0 && (
          <Card variant="neutral" padding="normal">
            <p style={{ margin: 0, color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
              {query
                ? `No cross-project learnings match "${query}"${activeProject ? ` in ${activeProject}` : ''}.`
                : 'No cross-project learnings yet. Use `knit_record_global_learning` for patterns that generalize.'}
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search summary, lesson, tags…"
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

function GlobalLearningRow({ entry }: { entry: GlobalLearning }) {
  return (
    <Card variant="neutral" padding="normal">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: 8,
            marginBottom: 6, fontSize: 'var(--size-eyebrow)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color: 'var(--text-mute-dark)',
          }}>
            <span style={{
              padding: '2px 8px', background: 'var(--surface-mint)',
              color: 'var(--text-dark)', borderRadius: 'var(--radius-pill)',
            }}>{entry.sourceProjectName}</span>
            <span>{entry.date}</span>
            {entry.outcome && <OutcomeBadge outcome={entry.outcome} />}
          </div>
          <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-body)', marginBottom: 6 }}>
            {entry.summary}
          </div>
          {entry.lesson && (
            <p style={{
              margin: 0, color: 'var(--text-mute-dark)', lineHeight: 1.55,
              fontSize: 'var(--size-label)',
            }}>
              {entry.lesson.length > 320 ? entry.lesson.slice(0, 320) + '…' : entry.lesson}
            </p>
          )}
          {entry.tags.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {entry.tags.slice(0, 8).map((t) => (
                <span key={t} style={{
                  padding: '2px 10px',
                  border: '1px solid var(--hairline)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--size-eyebrow)',
                  color: 'var(--text-mute-dark)',
                  fontWeight: 'var(--weight-medium)',
                }}>{t}</span>
              ))}
            </div>
          )}
        </div>
        <ArrowUpRight size={14} />
      </div>
    </Card>
  );
}

function OutcomeBadge({ outcome }: { outcome: 'success' | 'partial' | 'failure' }) {
  const color = outcome === 'success' ? '#15803d' : outcome === 'partial' ? '#a16207' : '#b91c1c';
  return (
    <span style={{
      color, fontWeight: 'var(--weight-semibold)',
    }}>{outcome}</span>
  );
}
