import { describe, it, expect } from 'vitest';
import {
  computeNeighborhood,
  rankLearningsByGraph,
} from '../src/engine/retrieval/graph-traversal.js';
import type { KBEntry } from '../src/engine/types.js';

/**
 * v0.8.1 — graph-traversal retriever.
 *
 * Pins the 1-hop neighborhood semantics + the scoring rule (2 per anchor
 * mention, 1 per neighbor mention). If a future refactor weights direct
 * vs indirect mentions differently, these tests fail-fast on the change.
 */

const fwd: Record<string, string[]> = {
  'src/auth.ts': ['src/types.ts', 'src/utils.ts'],
  'src/session.ts': ['src/auth.ts'],
  'src/payment.ts': ['src/types.ts'],
};
const rev: Record<string, string[]> = {
  'src/types.ts': ['src/auth.ts', 'src/payment.ts'],
  'src/utils.ts': ['src/auth.ts'],
  'src/auth.ts': ['src/session.ts'],
};

describe('computeNeighborhood', () => {
  it('walks 1 hop in both directions', () => {
    const n = computeNeighborhood(['src/auth.ts'], fwd, rev);
    expect([...n.anchors]).toEqual(['src/auth.ts']);
    // Forward: types.ts, utils.ts. Reverse: session.ts.
    expect(n.neighbors).toEqual(new Set(['src/types.ts', 'src/utils.ts', 'src/session.ts']));
  });

  it('handles multiple anchors and de-duplicates', () => {
    const n = computeNeighborhood(['src/auth.ts', 'src/payment.ts'], fwd, rev);
    expect(n.anchors).toEqual(new Set(['src/auth.ts', 'src/payment.ts']));
    // types.ts is a neighbor of both anchors — appears once.
    expect(n.neighbors.has('src/types.ts')).toBe(true);
    expect(n.neighbors.has('src/utils.ts')).toBe(true);
    expect(n.neighbors.has('src/session.ts')).toBe(true);
  });

  it('does NOT list anchors as their own neighbors', () => {
    // session.ts imports auth.ts; anchoring on both means session.ts shouldn't
    // appear in neighbors even though it's in auth.ts's reverseDeps.
    const n = computeNeighborhood(['src/auth.ts', 'src/session.ts'], fwd, rev);
    expect(n.neighbors.has('src/auth.ts')).toBe(false);
    expect(n.neighbors.has('src/session.ts')).toBe(false);
  });

  it('returns empty neighbors when anchor is leaf with no edges', () => {
    const n = computeNeighborhood(['src/unknown.ts'], fwd, rev);
    expect(n.anchors).toEqual(new Set(['src/unknown.ts']));
    expect(n.neighbors.size).toBe(0);
  });

  it('returns empty everything when no anchors', () => {
    const n = computeNeighborhood([], fwd, rev);
    expect(n.anchors.size).toBe(0);
    expect(n.neighbors.size).toBe(0);
  });
});

describe('rankLearningsByGraph', () => {
  const entries: KBEntry[] = [
    {
      id: 'l1',
      date: '2026-05-19',
      summary: 'Auth token rotation pattern',
      domains: ['API'],
      approach: 'Edit src/auth.ts and update src/types.ts',
      outcome: 'success',
      lesson: 'Always invalidate the prior token immediately.',
      tags: ['#auth'],
      accessCount: 0,
      lastAccessed: null,
    },
    {
      id: 'l2',
      date: '2026-05-19',
      summary: 'Session middleware refactor',
      domains: ['API'],
      approach: '',
      outcome: 'success',
      lesson: 'When src/session.ts changes, re-run integration tests.',
      tags: ['#session'],
      accessCount: 0,
      lastAccessed: null,
    },
    {
      id: 'l3',
      date: '2026-05-19',
      summary: 'Payment webhook signature verification',
      domains: ['Payments'],
      approach: 'Read req.rawBody first',
      outcome: 'success',
      lesson: 'Stripe webhook signatures fail silently if body is parsed before raw bytes captured.',
      tags: ['#payments'],
      accessCount: 0,
      lastAccessed: null,
    },
  ];

  it('returns empty when neighborhood is empty', () => {
    const results = rankLearningsByGraph(entries, { anchors: new Set(), neighbors: new Set() });
    expect(results).toEqual([]);
  });

  it('anchor mentions score 2, neighbor mentions score 1', () => {
    // Anchor = src/auth.ts. Neighbors include src/types.ts, src/session.ts.
    const n = computeNeighborhood(['src/auth.ts'], fwd, rev);
    const results = rankLearningsByGraph(entries, n);

    // l1 mentions both anchor (src/auth.ts) AND a neighbor (src/types.ts) → 2 + 1 = 3
    // l2 mentions a neighbor only (src/session.ts) → 1
    // l3 mentions nothing in the neighborhood → omitted
    expect(results.length).toBe(2);
    expect(results[0].id).toBe('l1');
    expect(results[0].score).toBe(3);
    expect(results[1].id).toBe('l2');
    expect(results[1].score).toBe(1);
  });

  it('ranks by score descending', () => {
    const n = computeNeighborhood(['src/auth.ts'], fwd, rev);
    const results = rankLearningsByGraph(entries, n);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
  });

  it('lists matched files in the result for diagnostics', () => {
    const n = computeNeighborhood(['src/auth.ts'], fwd, rev);
    const top = rankLearningsByGraph(entries, n)[0];
    expect(top.matched).toContain('src/auth.ts');
    expect(top.matched).toContain('src/types.ts');
  });
});
