import { useEffect, useState } from 'react';
import { api, type BrainAggregate, type ProjectSummary } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import {
  Card, Eyebrow, HeroNumber, StatNumber, DeltaPill, ArrowUpRight,
  Loading, ErrorBanner,
} from '../components/Card';

export function HomeView() {
  const [agg, setAgg] = useState<BrainAggregate | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sync = useBrainSync();

  // Re-fetch on every brain change (debounced server-side to 250ms).
  useEffect(() => {
    Promise.all([api.brainAggregate(), api.projects()])
      .then(([a, p]) => { setAgg(a); setProjects(p.projects); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [sync.tick]);

  if (error) return <ErrorBanner message={error} hint="Server may be stopped — restart with `knit ui`." />;
  if (!agg || !projects) return <Loading />;

  const tokensSavedDisplay = formatTokens(agg.totalTokensSaved);
  const tokensSpentDisplay = formatTokens(agg.totalTokensSpent);
  const netDisplay = formatTokens(Math.abs(agg.netTokenDelta));
  const netPositive = agg.netTokenDelta >= 0;
  const reuseRatio = agg.totalSessions > 0
    ? Math.min(100, Math.round((agg.totalCacheHits / agg.totalSessions) * 100))
    : 0;

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(12, minmax(0, 1fr))',
      gap: 'var(--space-4)',
    }}>
      {/* HERO — Brain savings (dark, large, top-left) */}
      <div style={{ gridColumn: 'span 8' }}>
        <Card variant="dark" padding="large" style={{ minHeight: 320, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: 'var(--size-h2)', fontWeight: 'var(--weight-semibold)' }}>
                Brain savings
              </div>
              <div style={{ color: 'var(--text-mute-light)', fontSize: 'var(--size-label)', marginTop: 4 }}>
                Across {agg.projectCount} project{agg.projectCount === 1 ? '' : 's'}
                {sync.lastChangeAt && <> · updated just now</>}
              </div>
            </div>
            <PeriodChip />
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 'var(--space-6)' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ color: 'var(--text-mute-light)', fontSize: 'var(--size-label)' }}>Net tokens</span>
                <DeltaPill value={`${netPositive ? '+' : '−'}${netDisplay}`} positive={netPositive} />
              </div>
              <HeroNumber>{tokensSavedDisplay}</HeroNumber>
              <div style={{ color: 'var(--text-mute-light)', fontSize: 'var(--size-label)', marginTop: 6 }}>
                saved · {tokensSpentDisplay} spent
              </div>
            </div>
            <SavedVsSpentBars saved={agg.totalTokensSaved} spent={agg.totalTokensSpent} />
          </div>
        </Card>
      </div>

      {/* Recent activity — Neutral, top-right */}
      <div style={{ gridColumn: 'span 4' }}>
        <Card variant="neutral" padding="normal" style={{ minHeight: 320, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <CircleIcon variant="dark"><ActivityGlyph /></CircleIcon>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>Recent activity</div>
              <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
                {sync.connected ? <LiveDot /> : 'Connecting…'} from <code>{agg.totalLearnings}</code> learnings
              </div>
            </div>
          </div>
          <RecentActivityList projects={projects} />
        </Card>
      </div>

      {/* Memory hit-rate — Mint inside neutral wrap */}
      <div style={{ gridColumn: 'span 5' }}>
        <Card variant="neutral" padding="normal" style={{ minHeight: 320 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>Memory hit rate</div>
            <ArrowButton />
          </div>
          <Card variant="mint" radius="inner" padding="large">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-4)' }}>
              <div>
                <CircleIcon variant="glass" size={44}><ChartGlyph /></CircleIcon>
                <div style={{ marginTop: 'var(--space-7)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 'var(--size-h2)', fontWeight: 'var(--weight-bold)' }}>{reuseRatio}%</span>
                  <ArrowUpRight size={14} />
                </div>
                <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', marginTop: 4 }}>
                  {agg.totalCacheHits} hits across {agg.totalSessions} sessions
                </div>
              </div>
              <HitRateArc value={reuseRatio} />
            </div>
          </Card>
        </Card>
      </div>

      {/* Project timeline + featured projects (right column wrap) */}
      <div style={{ gridColumn: 'span 7' }}>
        <Card variant="neutral" padding="normal" style={{ minHeight: 320 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <CircleIcon variant="mint"><ChartGlyph /></CircleIcon>
            <div style={{ fontSize: 'var(--size-h3)', fontWeight: 'var(--weight-semibold)' }}>Top projects</div>
            <div style={{ marginLeft: 'auto', color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
              by net tokens saved
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            {agg.topProjects.slice(0, 2).map((p, i) => (
              <a key={p.id} href={`#/p/${p.id}`} style={{ textDecoration: 'none' }}>
                <Card
                  variant={i === 0 ? 'mint' : 'lavender'}
                  radius="inner"
                  padding="normal"
                  style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 180 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <Eyebrow>{p.verdict}</Eyebrow>
                    <ArrowUpRight size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)', marginBottom: 4 }}>
                      {p.name}
                    </div>
                    <StatNumber>{formatTokens(Math.abs(p.netTokenDelta))}</StatNumber>
                    <div style={{ fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)', marginTop: 4 }}>
                      {p.netTokenDelta >= 0 ? 'saved' : 'spent net'}
                    </div>
                  </div>
                </Card>
              </a>
            ))}
            {agg.topProjects.length === 0 && (
              <Card variant="glass" radius="inner" padding="normal">
                <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
                  No projects yet. The brain initializes on the first MCP call.
                </div>
              </Card>
            )}
          </div>
          {projects.length > 0 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <ProjectTimeline projects={projects} />
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}

function PeriodChip() {
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: 'rgba(255, 255, 255, 0.08)',
      color: 'var(--text-light)',
      padding: '6px 12px',
      borderRadius: 'var(--radius-pill)',
      fontSize: 'var(--size-label)',
    }}>
      All-time
      <svg width={10} height={10} viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" /></svg>
    </div>
  );
}

function LiveDot() {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      color: '#15803d', fontWeight: 'var(--weight-medium)',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: 999,
        background: '#22c55e',
      }} />
      live
    </span>
  );
}

function CircleIcon({ children, variant = 'dark', size = 36 }: { children: React.ReactNode; variant?: 'dark' | 'mint' | 'lavender' | 'glass'; size?: number }) {
  const bg = {
    dark: 'var(--surface-dark)',
    mint: 'var(--surface-mint)',
    lavender: 'var(--surface-lavender)',
    glass: 'var(--surface-glass)',
  }[variant];
  const fg = variant === 'dark' ? 'var(--text-light)' : 'var(--text-dark)';
  return (
    <div style={{
      width: size, height: size, borderRadius: 999,
      background: bg, color: fg,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      {children}
    </div>
  );
}

function ArrowButton() {
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 999,
      border: '1px solid var(--hairline)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: 'var(--text-dark)',
    }}>
      <ArrowUpRight size={14} />
    </div>
  );
}

function ActivityGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChartGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 18l5-5 4 4 7-9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RecentActivityList({ projects }: { projects: ProjectSummary[] }) {
  const recent = projects.filter((p) => p.lastActive).slice(0, 4);
  if (recent.length === 0) {
    return (
      <div style={{
        marginTop: 'var(--space-4)', color: 'var(--text-mute-dark)',
        fontSize: 'var(--size-label)',
      }}>
        Activity will appear here once any agent records a learning.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 'var(--space-4)', display: 'grid', gap: 6 }}>
      {recent.map((p) => (
        <a key={p.id} href={`#/p/${p.id}`} style={{ textDecoration: 'none' }}>
          <Card variant="glass" radius="inner" padding="tight" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <CircleIcon variant="mint" size={28}><ChartGlyph /></CircleIcon>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </div>
              <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {p.learningCount} learning{p.learningCount === 1 ? '' : 's'} · {p.lastActive}
              </div>
            </div>
            <ArrowUpRight size={14} />
          </Card>
        </a>
      ))}
    </div>
  );
}

function SavedVsSpentBars({ saved, spent }: { saved: number; spent: number }) {
  // Two stacked-bar columns showing saved (mint) and spent (lavender) — echoes
  // the Monetir "Sales statistics" two-month comparison bars.
  const max = Math.max(saved, spent, 1);
  const savedH = Math.round((saved / max) * 120);
  const spentH = Math.round((spent / max) * 120);
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
      <BarColumn label="Saved" colorTop="var(--surface-mint)" colorBottom="var(--surface-lavender)" topH={savedH * 0.7} bottomH={savedH * 0.3} />
      <BarColumn label="Spent" colorTop="var(--surface-mint)" colorBottom="var(--surface-lavender)" topH={spentH * 0.25} bottomH={spentH * 0.75} />
    </div>
  );
}

function BarColumn({ label, colorTop, colorBottom, topH, bottomH }: { label: string; colorTop: string; colorBottom: string; topH: number; bottomH: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div style={{
        color: 'var(--text-mute-light)', fontSize: 'var(--size-eyebrow)',
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: 140 }}>
        <div style={{ width: 48, background: colorTop, height: Math.max(topH, 8), borderRadius: '10px 10px 4px 4px' }} />
        <div style={{ width: 48, background: colorBottom, height: Math.max(bottomH, 8), borderRadius: '4px 4px 10px 10px' }} />
      </div>
    </div>
  );
}

function HitRateArc({ value }: { value: number }) {
  // Half-donut showing the % filled. Mint background, dark arc.
  const size = 130;
  const stroke = 18;
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size - stroke / 2;
  const startAngle = Math.PI; // 180°
  const endAngle = Math.PI - (value / 100) * Math.PI;
  const x1 = cx + r * Math.cos(startAngle);
  const y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle);
  const y2 = cy + r * Math.sin(endAngle);
  const largeArc = value > 50 ? 1 : 0;
  return (
    <svg width={size} height={size / 2 + stroke}>
      <path
        d={`M ${stroke / 2} ${cy} A ${r} ${r} 0 0 1 ${size - stroke / 2} ${cy}`}
        stroke="rgba(13, 13, 13, 0.12)"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
      />
      <path
        d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`}
        stroke="var(--text-dark)"
        strokeWidth={stroke}
        strokeLinecap="round"
        fill="none"
      />
      <circle cx={x2} cy={y2} r={stroke / 3} fill="var(--surface-lavender)" stroke="var(--text-dark)" strokeWidth={2} />
    </svg>
  );
}

function ProjectTimeline({ projects }: { projects: ProjectSummary[] }) {
  // Vertical timeline echoing the Monetir "Market forecast" timeline.
  const items = projects.slice(0, 4);
  if (items.length <= 2) return null;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '12px 1fr',
      gap: '0 var(--space-3)', alignItems: 'flex-start',
      paddingTop: 'var(--space-3)',
      borderTop: '1px solid var(--hairline)',
      marginTop: 'var(--space-3)',
    }}>
      {items.map((p, i) => (
        <div key={p.id} style={{ display: 'contents' }}>
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            paddingTop: 6,
          }}>
            <div style={{
              width: 10, height: 10, borderRadius: 999,
              background: i === items.length - 1 ? 'var(--text-dark)' : 'var(--surface-neutral)',
              border: '1.5px solid var(--text-dark)',
            }} />
            {i < items.length - 1 && (
              <div style={{ width: 1.5, height: 30, background: 'var(--hairline)' }} />
            )}
          </div>
          <a href={`#/p/${p.id}`} style={{ textDecoration: 'none', marginBottom: i < items.length - 1 ? 'var(--space-2)' : 0 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)',
            }}>
              <span>{p.name}</span>
              <span className="tabular" style={{ color: 'var(--text-mute-dark)' }}>
                {p.learningCount}
              </span>
            </div>
          </a>
        </div>
      ))}
    </div>
  );
}
