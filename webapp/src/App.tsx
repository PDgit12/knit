import { useEffect, useState } from 'react';

interface BrainSummary {
  projectCount: number;
  totalLearnings: number;
  globalLearnings: number;
  knitVersion: string;
  knitHome: string;
}

export function App() {
  const [summary, setSummary] = useState<BrainSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brain/summary')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<BrainSummary>;
      })
      .then(setSummary)
      .catch((err) => setError(err.message));
  }, []);

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '3rem 1.5rem' }}>
      <header style={{ marginBottom: '2.5rem' }}>
        <h1 style={{
          fontSize: '2rem', fontWeight: 600, margin: 0,
          background: 'linear-gradient(90deg, var(--accent), var(--accent-2))',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>
          Knit Dashboard
        </h1>
        <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem' }}>
          Local-first analytics on top of <code>~/.knit/</code>. v1.0-alpha — read-only.
        </p>
      </header>

      {error && (
        <div style={{
          padding: '1rem', border: '1px solid #7c2d2d', background: '#2a1010',
          borderRadius: 8, color: '#f8b4b4',
        }}>
          <strong>Could not connect to dashboard server.</strong>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
            Error: <code>{error}</code>
          </p>
          <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
            Make sure the dashboard server is running. Start it with: <code>knit dashboard</code>
          </p>
        </div>
      )}

      {!summary && !error && (
        <div style={{ color: 'var(--text-dim)' }}>Loading brain…</div>
      )}

      {summary && (
        <section style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem',
        }}>
          <Stat label="Projects" value={summary.projectCount} />
          <Stat label="Project learnings" value={summary.totalLearnings} />
          <Stat label="Global learnings" value={summary.globalLearnings} />
          <Stat label="Knit version" value={summary.knitVersion} mono />
        </section>
      )}

      {summary && (
        <footer style={{ marginTop: '3rem', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
          Reading from <code>{summary.knitHome}</code>
        </footer>
      )}
    </main>
  );
}

function Stat({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div style={{
      padding: '1.25rem', background: 'var(--surface)',
      border: '1px solid var(--border)', borderRadius: 12,
    }}>
      <div style={{
        fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--text-dim)', marginBottom: '0.5rem',
      }}>{label}</div>
      <div style={{
        fontSize: '1.875rem', fontWeight: 600,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
      }}>{value}</div>
    </div>
  );
}
