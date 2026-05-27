import type { ReactNode, CSSProperties } from 'react';

// Card surface variants. Monetir aesthetic: color-blocked, no shadow.
export type CardVariant = 'dark' | 'mint' | 'lavender' | 'neutral' | 'glass';

const VARIANT_BG: Record<CardVariant, string> = {
  dark: 'var(--surface-dark)',
  mint: 'var(--surface-mint)',
  lavender: 'var(--surface-lavender)',
  neutral: 'var(--surface-neutral)',
  glass: 'var(--surface-glass)',
};

const VARIANT_FG: Record<CardVariant, string> = {
  dark: 'var(--text-light)',
  mint: 'var(--text-dark)',
  lavender: 'var(--text-dark)',
  neutral: 'var(--text-dark)',
  glass: 'var(--text-dark)',
};

const VARIANT_MUTE: Record<CardVariant, string> = {
  dark: 'var(--text-mute-light)',
  mint: 'var(--text-mute-dark)',
  lavender: 'var(--text-mute-dark)',
  neutral: 'var(--text-mute-dark)',
  glass: 'var(--text-mute-dark)',
};

export function Card({
  children, variant = 'neutral', padding = 'normal', radius = 'card', style, onClick,
}: {
  children: ReactNode;
  variant?: CardVariant;
  padding?: 'normal' | 'tight' | 'large';
  radius?: 'card' | 'inner';
  style?: CSSProperties;
  onClick?: () => void;
}) {
  const pad = padding === 'tight' ? 'var(--space-4)' : padding === 'large' ? 'var(--space-7)' : 'var(--space-6)';
  return (
    <div
      onClick={onClick}
      style={{
        background: VARIANT_BG[variant],
        color: VARIANT_FG[variant],
        borderRadius: radius === 'inner' ? 'var(--radius-card-inner)' : 'var(--radius-card)',
        padding: pad,
        cursor: onClick ? 'pointer' : undefined,
        transition: onClick ? 'transform var(--duration-fast) var(--ease)' : undefined,
        ...style,
        // Expose the per-card mute color so children can reference it.
        ['--card-mute' as string]: VARIANT_MUTE[variant],
      }}
      onMouseDown={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = 'scale(0.99)'; } : undefined}
      onMouseUp={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = ''; } : undefined}
      onMouseLeave={onClick ? (e) => { (e.currentTarget as HTMLElement).style.transform = ''; } : undefined}
    >
      {children}
    </div>
  );
}

// Tiny inline icons drawn as SVG — no icon library dep.
export function ArrowUpRight({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M7 17 L17 7 M9 7 H17 V15" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function DeltaPill({ value, positive = true }: { value: string; positive?: boolean }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '4px 10px',
      background: positive ? 'var(--surface-mint)' : 'rgba(239, 68, 68, 0.15)',
      color: positive ? 'var(--text-dark)' : '#b91c1c',
      borderRadius: 'var(--radius-pill)',
      fontSize: 'var(--size-label)',
      fontWeight: 'var(--weight-semibold)',
      fontFeatureSettings: "'tnum'",
    }}>
      {positive && <ArrowUpRight size={12} />}
      {value}
    </span>
  );
}

export function Eyebrow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{
      fontSize: 'var(--size-eyebrow)',
      textTransform: 'uppercase',
      letterSpacing: '0.08em',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--card-mute, var(--text-mute-dark))',
      ...style,
    }}>{children}</div>
  );
}

export function HeroNumber({
  children, mute, style,
}: { children: ReactNode; mute?: boolean; style?: CSSProperties }) {
  return (
    <div
      className="tabular"
      style={{
        fontSize: 'var(--size-hero)',
        fontWeight: 'var(--weight-bold)',
        lineHeight: 0.95,
        letterSpacing: '-0.02em',
        color: mute ? 'var(--card-mute, var(--text-mute-dark))' : 'inherit',
        ...style,
      }}
    >{children}</div>
  );
}

export function StatNumber({
  children, style,
}: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      className="tabular"
      style={{
        fontSize: 'var(--size-stat)',
        fontWeight: 'var(--weight-bold)',
        lineHeight: 1,
        letterSpacing: '-0.015em',
        ...style,
      }}
    >{children}</div>
  );
}

export function Loading() {
  return <div style={{ color: 'var(--text-mute-dark)', padding: 'var(--space-4)' }}>Loading…</div>;
}

export function ErrorBanner({ message, hint }: { message: string; hint?: string }) {
  return (
    <Card variant="neutral" padding="tight" style={{ borderLeft: '3px solid #ef4444' }}>
      <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 4 }}>Could not load.</div>
      <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
        <code>{message}</code>
      </div>
      {hint && (
        <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', marginTop: 8 }}>
          {hint}
        </div>
      )}
    </Card>
  );
}
