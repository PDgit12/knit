import { useEffect, useState } from 'react';
import { api, type VersionInfo } from '../api/client';

// Polls /api/version on mount + every 5 minutes. When the server's
// best-effort npm registry check detects a newer knit-mcp on disk
// than the one currently running, surface a non-modal banner with
// the one-line install command.
//
// Local-first invariant: the npm-registry check happens server-side
// (background-cached via prewarmLatestVersion). The client never
// calls npm directly.

const POLL_MS = 5 * 60 * 1000;

export function UpdateBanner() {
  const [info, setInfo] = useState<VersionInfo | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem('knit-update-dismissed'); } catch { return null; }
  });

  useEffect(() => {
    let cancelled = false;
    const tick = (): void => {
      api.version()
        .then((v) => { if (!cancelled) setInfo(v); })
        .catch(() => { /* network blip — silent, re-poll later */ });
    };
    tick();
    const interval = window.setInterval(tick, POLL_MS);
    return () => { cancelled = true; window.clearInterval(interval); };
  }, []);

  if (!info || !info.updateAvailable || !info.latestVersion) return null;
  if (dismissed === info.latestVersion) return null;

  return (
    <div style={{
      maxWidth: 1240, margin: '0 auto', padding: '0 var(--space-5)',
    }}>
      <div style={{
        background: 'var(--surface-dark)', color: 'var(--text-light)',
        borderRadius: 'var(--radius-card-inner)', padding: 'var(--space-3) var(--space-4)',
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        marginBottom: 'var(--space-3)',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: 999, flexShrink: 0,
          background: 'var(--surface-mint)', color: 'var(--text-dark)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'var(--weight-bold)', fontSize: 14,
        }}>↑</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-body)' }}>
            Update available — knit-mcp {info.latestVersion}
          </div>
          <div style={{
            color: 'var(--text-mute-light)', fontSize: 'var(--size-label)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            You&apos;re on {info.knitVersion}. Run: <code>{info.updateCommand}</code>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            if (info.updateCommand) {
              navigator.clipboard?.writeText(info.updateCommand).catch(() => {});
            }
          }}
          aria-label="Copy update command to clipboard"
          style={{
            background: 'var(--surface-mint)', color: 'var(--text-dark)',
            border: 'none', padding: '8px 14px',
            borderRadius: 'var(--radius-pill)',
            fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-label)',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          Copy command
        </button>
        <button
          type="button"
          onClick={() => {
            try { sessionStorage.setItem('knit-update-dismissed', info.latestVersion ?? ''); } catch { /* noop */ }
            setDismissed(info.latestVersion);
          }}
          aria-label="Dismiss"
          style={{
            background: 'transparent', color: 'var(--text-mute-light)',
            border: 'none', padding: 8, cursor: 'pointer',
            fontSize: 18, lineHeight: 1, flexShrink: 0,
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
