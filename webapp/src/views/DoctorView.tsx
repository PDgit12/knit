import { useEffect, useState, useCallback } from 'react';
import { api, type GlobalDoctorReport, type GlobalDoctorCheck } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import {
  Card, Eyebrow, StatNumber,
  Loading, ErrorBanner,
} from '../components/Card';

const STATUS_BG: Record<GlobalDoctorCheck['status'], string> = {
  ok: 'var(--surface-mint)',
  warn: 'var(--surface-lavender)',
  error: '#ef4444',
  info: 'var(--surface-glass)',
};
const STATUS_FG: Record<GlobalDoctorCheck['status'], string> = {
  ok: 'var(--text-dark)',
  warn: 'var(--text-dark)',
  error: '#ffffff',
  info: 'var(--text-dark)',
};
const STATUS_GLYPH: Record<GlobalDoctorCheck['status'], string> = {
  ok: '✓', warn: '!', error: '✗', info: 'i',
};

export function DoctorView() {
  const [report, setReport] = useState<GlobalDoctorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const sync = useBrainSync();

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    api.doctor()
      .then(setReport)
      .catch((err: Error) => setError(err.message))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => { load(); }, [load, sync.tick]);

  if (error) return <ErrorBanner message={error} />;
  if (!report) return <Loading />;

  const overall: GlobalDoctorCheck['status'] = report.summary.error > 0 ? 'error' : report.summary.warn > 0 ? 'warn' : 'ok';
  const heroVariant: 'dark' | 'lavender' | 'mint' = overall === 'error' ? 'dark' : overall === 'warn' ? 'lavender' : 'mint';

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: 0, letterSpacing: '-0.01em' }}>
            Install health
          </h1>
          <p style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', margin: '4px 0 0' }}>
            Local environment checks. Per-project doctor still on the terminal — <code>knit doctor</code>.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={refreshing}
          style={{
            background: 'var(--surface-dark)', color: 'var(--text-light)',
            border: 'none', padding: '10px 18px',
            borderRadius: 'var(--radius-pill)',
            fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)',
            cursor: refreshing ? 'wait' : 'pointer',
            opacity: refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Running…' : 'Re-run checks'}
        </button>
      </div>

      {/* Hero verdict + summary counters */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 5' }}>
          <Card variant={heroVariant} padding="large" style={{ minHeight: 200 }}>
            <Eyebrow style={{ color: heroVariant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)' }}>
              Overall verdict
            </Eyebrow>
            <div style={{
              marginTop: 'var(--space-3)', fontSize: 'var(--size-hero)',
              fontWeight: 'var(--weight-bold)', lineHeight: 0.95,
              letterSpacing: '-0.02em',
            }}>
              {overall === 'ok' ? 'Healthy' : overall === 'warn' ? 'Warnings' : 'Errors'}
            </div>
            <div style={{
              marginTop: 'var(--space-3)', fontSize: 'var(--size-label)',
              color: heroVariant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)',
            }}>
              {report.summary.ok} OK · {report.summary.warn} warn · {report.summary.error} error · {report.summary.info} info
            </div>
          </Card>
        </div>
        <div style={{ gridColumn: 'span 7', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
          <CounterCard label="OK" count={report.summary.ok} variant={report.summary.ok > 0 ? 'mint' : 'neutral'} />
          <CounterCard label="Warnings" count={report.summary.warn} variant={report.summary.warn > 0 ? 'lavender' : 'neutral'} />
          <CounterCard label="Errors" count={report.summary.error} variant={report.summary.error > 0 ? 'dark' : 'neutral'} />
          <CounterCard label="Info" count={report.summary.info} variant="neutral" />
        </div>
      </div>

      {/* Environment facts */}
      <Card variant="neutral" padding="normal">
        <Eyebrow>Environment</Eyebrow>
        <div style={{
          marginTop: 'var(--space-3)',
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-4)',
        }}>
          <FactRow label="Knit version" value={report.knitVersion} mono />
          <FactRow label="Node version" value={report.nodeVersion} mono />
          <FactRow label="Knit home" value={report.knitHome} mono />
        </div>
      </Card>

      {/* Check list */}
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {report.checks.map((c, i) => (
          <CheckRow key={i} check={c} />
        ))}
      </div>
    </div>
  );
}

function CounterCard({ label, count, variant }: { label: string; count: number; variant: 'mint' | 'lavender' | 'dark' | 'neutral' }) {
  return (
    <Card variant={variant} padding="normal" style={{ minHeight: 96 }}>
      <Eyebrow style={{ color: variant === 'dark' ? 'var(--text-mute-light)' : 'var(--text-mute-dark)' }}>
        {label}
      </Eyebrow>
      <div style={{ marginTop: 'var(--space-2)' }}>
        <StatNumber>{count}</StatNumber>
      </div>
    </Card>
  );
}

function FactRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase',
        letterSpacing: '0.06em', color: 'var(--text-mute-dark)',
        marginBottom: 4,
      }}>{label}</div>
      <div style={{
        fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}

function CheckRow({ check }: { check: GlobalDoctorCheck }) {
  return (
    <Card variant="neutral" padding="normal">
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
        <div style={{
          width: 32, height: 32, borderRadius: 999,
          background: STATUS_BG[check.status],
          color: STATUS_FG[check.status],
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'var(--weight-bold)', fontSize: 14, flexShrink: 0,
          border: check.status === 'info' ? '1px solid var(--hairline)' : 'none',
        }}>{STATUS_GLYPH[check.status]}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-body)' }}>
            {check.name}
          </div>
          <div style={{
            color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)',
            marginTop: 4, lineHeight: 1.5,
            wordBreak: 'break-word',
          }}>
            {check.detail}
          </div>
        </div>
      </div>
    </Card>
  );
}
