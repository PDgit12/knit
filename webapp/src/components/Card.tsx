import type { ReactNode } from 'react';

export function Card({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      padding: '1.25rem',
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      ...style,
    }}>
      {children}
    </div>
  );
}

export function Stat({ label, value, mono, hint }: {
  label: string;
  value: string | number;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <Card>
      <div style={{
        fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em',
        color: 'var(--text-dim)', marginBottom: '0.5rem',
      }}>{label}</div>
      <div style={{
        fontSize: '1.875rem', fontWeight: 600,
        fontFamily: mono ? 'ui-monospace, monospace' : undefined,
      }}>{value}</div>
      {hint && <div style={{ marginTop: '0.5rem', color: 'var(--text-dim)', fontSize: '0.75rem' }}>{hint}</div>}
    </Card>
  );
}

export function Loading() {
  return <div style={{ color: 'var(--text-dim)' }}>Loading…</div>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      padding: '1rem', border: '1px solid #7c2d2d', background: '#2a1010',
      borderRadius: 8, color: '#f8b4b4',
    }}>
      <strong>Error.</strong>
      <p style={{ margin: '0.5rem 0 0', fontSize: '0.875rem' }}>
        <code>{message}</code>
      </p>
    </div>
  );
}
