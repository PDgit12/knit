import { useEffect, useState, useCallback } from 'react';
import { api, type GlobalDoctorReport, type GlobalDoctorCheck } from '../api/client';
import { Card, Loading, ErrorBanner } from '../components/Card';

const STATUS_COLOR: Record<GlobalDoctorCheck['status'], string> = {
  ok: '#22c55e',
  warn: '#eab308',
  error: '#ef4444',
  info: '#8a9098',
};

const STATUS_ICON: Record<GlobalDoctorCheck['status'], string> = {
  ok: '✓',
  warn: '!',
  error: '✗',
  info: 'i',
};

export function DoctorView() {
  const [report, setReport] = useState<GlobalDoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    api.doctor()
      .then(setReport)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <>
      <header style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '1.75rem', fontWeight: 600, margin: 0 }}>Install health</h1>
          <button
            type="button"
            onClick={load}
            disabled={refreshing}
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              padding: '0.4rem 0.9rem',
              borderRadius: 8,
              fontSize: '0.8125rem',
              cursor: refreshing ? 'wait' : 'pointer',
              opacity: refreshing ? 0.6 : 1,
            }}
          >
            {refreshing ? 'Running…' : 'Re-run checks'}
          </button>
        </div>
        <p style={{ color: 'var(--text-dim)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Local environment checks. Per-project doctor (touching CLAUDE.md, hooks, etc.) is still on the terminal — <code>knit doctor</code> from your repo.
        </p>
      </header>

      {error && <ErrorBanner message={error} />}
      {!report && !error && <Loading />}

      {report && (
        <>
          <section style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '0.75rem',
            marginBottom: '1.5rem',
          }}>
            <Counter label="OK" count={report.summary.ok} color={STATUS_COLOR.ok} />
            <Counter label="Warnings" count={report.summary.warn} color={STATUS_COLOR.warn} />
            <Counter label="Errors" count={report.summary.error} color={STATUS_COLOR.error} />
            <Counter label="Info" count={report.summary.info} color={STATUS_COLOR.info} />
          </section>

          <Card style={{ marginBottom: '1.5rem' }}>
            <dl style={{
              display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.375rem 1rem', margin: 0,
              fontSize: '0.875rem',
            }}>
              <dt style={{ color: 'var(--text-dim)' }}>Knit version</dt>
              <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>{report.knitVersion}</dd>
              <dt style={{ color: 'var(--text-dim)' }}>Node version</dt>
              <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>{report.nodeVersion}</dd>
              <dt style={{ color: 'var(--text-dim)' }}>Knit home</dt>
              <dd style={{ margin: 0, fontFamily: 'ui-monospace, monospace' }}>{report.knitHome}</dd>
            </dl>
          </Card>

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            {report.checks.map((c, i) => (
              <Card key={i}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: 999,
                    background: STATUS_COLOR[c.status],
                    color: c.status === 'warn' ? '#000' : '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: '0.75rem', flexShrink: 0,
                  }}>{STATUS_ICON[c.status]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                      {c.detail}
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function Counter({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <Card style={{ borderColor: count > 0 ? color : 'var(--border)' }}>
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, color: count > 0 ? color : 'var(--text-dim)', marginTop: '0.25rem' }}>
        {count}
      </div>
    </Card>
  );
}
