import { useEffect, useRef, useState } from 'react';

// Real-time brain sync via Server-Sent Events.
//
// The dashboard server watches ~/.knit/ and pushes a 'change' event for
// every relevant file write (learnings, sessions, classifications).
// Components can subscribe to a bumping `tick` number and re-fetch their
// data whenever it changes. Debouncing happens server-side.
//
// Connection management:
//   - One EventSource per browser tab (singleton via module state).
//   - Auto-reconnect built into EventSource (browser handles it).
//   - 'connected' state surfaces in the UI as a small live indicator.

interface BrainSyncState {
  tick: number;            // bumps on every change event
  connected: boolean;      // true when SSE handshake completed
  lastChangePath: string | null;
  lastChangeAt: string | null;
}

let listeners: Array<(s: BrainSyncState) => void> = [];
let state: BrainSyncState = { tick: 0, connected: false, lastChangePath: null, lastChangeAt: null };
let source: EventSource | null = null;

function emit(): void { for (const l of listeners) l(state); }

function setupSource(): void {
  if (source) return;
  try {
    source = new EventSource('/api/events');
    source.addEventListener('hello', () => {
      state = { ...state, connected: true };
      emit();
    });
    source.addEventListener('change', (evt: MessageEvent) => {
      try {
        const data = JSON.parse(evt.data) as { path?: string; timestamp?: string };
        state = {
          tick: state.tick + 1,
          connected: true,
          lastChangePath: data.path ?? null,
          lastChangeAt: data.timestamp ?? new Date().toISOString(),
        };
        emit();
      } catch {
        // ignore malformed event
      }
    });
    source.addEventListener('ping', () => {
      if (!state.connected) {
        state = { ...state, connected: true };
        emit();
      }
    });
    source.onerror = () => {
      state = { ...state, connected: false };
      emit();
      // EventSource auto-reconnects; we just reflect the gap in UI.
    };
  } catch {
    // SSE unsupported — fall through to disconnected state. The UI
    // remains functional, just without live updates.
  }
}

export function useBrainSync(): BrainSyncState {
  const [s, setS] = useState<BrainSyncState>(state);
  const mounted = useRef(true);
  useEffect(() => {
    setupSource();
    const handler = (next: BrainSyncState): void => { if (mounted.current) setS(next); };
    listeners.push(handler);
    return () => {
      mounted.current = false;
      listeners = listeners.filter((l) => l !== handler);
    };
  }, []);
  return s;
}
