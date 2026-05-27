import { useEffect, useMemo, useRef, useState } from 'react';
import {
  forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide,
  type Simulation, type SimulationNodeDatum, type SimulationLinkDatum,
} from 'd3-force';
import { api, type BrainGraph, type GraphNode, type LearningEntry } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import { Card, Eyebrow, Loading, ErrorBanner, ArrowUpRight } from '../components/Card';

interface SimNode extends SimulationNodeDatum {
  id: string;
  label: string;
  domain: string;
  size: number;
  accessCount: number;
  tagCount: number;
}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  weight: number;
}

// Domain → color palette. Cycles deterministically so the same domain
// always gets the same hue, but doesn't blow up the bundle with a heavy
// palette dep.
const PALETTE = [
  '#b6f0a3', '#a594f9', '#0d0d0d', '#f8b4b4', '#fde68a',
  '#93c5fd', '#fda4af', '#86efac', '#c4b5fd', '#fcd34d',
];
function colorFor(domain: string): string {
  let h = 0;
  for (let i = 0; i < domain.length; i++) h = (h * 31 + domain.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

export function GraphView({ projectId }: { projectId: string }) {
  const [graph, setGraph] = useState<BrainGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState<number>(0.25);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<LearningEntry | null>(null);
  const sync = useBrainSync();

  useEffect(() => {
    api.projectGraph(projectId, threshold)
      .then((g) => { setGraph(g); setError(null); })
      .catch((err: Error) => setError(err.message));
  }, [projectId, threshold, sync.tick]);

  // On node selection, fetch the full learning detail (hierarchical retrieval).
  useEffect(() => {
    if (!selectedId) { setSelectedDetail(null); return; }
    let cancelled = false;
    api.projectLearnings(projectId).then((data) => {
      if (cancelled) return;
      const entry = data.learnings.find((l) => l.id === selectedId) ?? null;
      setSelectedDetail(entry);
    }).catch(() => { /* swallow — selection still works via the graph node label */ });
    return () => { cancelled = true; };
  }, [selectedId, projectId]);

  if (error) return <ErrorBanner message={error} />;
  if (!graph) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <a href={`#/p/${projectId}`} style={{
            color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)',
            fontWeight: 'var(--weight-medium)',
          }}>← {graph.projectName}</a>
          <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: '4px 0 0', letterSpacing: '-0.01em' }}>
            Brain graph
          </h1>
          <p style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', margin: '4px 0 0' }}>
            {graph.nodeCount} learnings · {graph.edgeCount} relations · {graph.isolatedCount} isolated
          </p>
        </div>
        <ThresholdSlider value={threshold} onChange={setThreshold} />
      </div>

      {/* Graph canvas + side panel */}
      <div style={{ display: 'grid', gridTemplateColumns: selectedId ? 'minmax(0, 1fr) 380px' : '1fr', gap: 'var(--space-4)' }}>
        <Card variant="neutral" padding="tight" style={{ minHeight: 560, padding: 0, overflow: 'hidden' }}>
          <GraphCanvas
            graph={graph}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Card>
        {selectedId && (
          <DetailPanel
            entry={selectedDetail}
            node={graph.nodes.find((n) => n.id === selectedId) ?? null}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {/* Legend */}
      <Card variant="neutral" padding="normal">
        <Eyebrow>Legend</Eyebrow>
        <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 'var(--space-3)', fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)' }}>
          <div><strong style={{ color: 'var(--text-dark)' }}>Node size</strong> · access count (log-scaled)</div>
          <div><strong style={{ color: 'var(--text-dark)' }}>Node color</strong> · primary domain</div>
          <div><strong style={{ color: 'var(--text-dark)' }}>Edge thickness</strong> · Jaccard similarity over tags+domains</div>
          <div><strong style={{ color: 'var(--text-dark)' }}>Isolated</strong> · no overlapping tags above threshold</div>
        </div>
      </Card>
    </div>
  );
}

// ─── Slider for the similarity threshold ───────────────────────────────

function ThresholdSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <Card variant="neutral" padding="tight" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', minWidth: 280 }}>
      <Eyebrow style={{ marginBottom: 0 }}>Similarity threshold</Eyebrow>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: 1 }}
      />
      <span className="tabular" style={{
        fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)',
        minWidth: 40, textAlign: 'right',
      }}>{value.toFixed(2)}</span>
    </Card>
  );
}

// ─── Force-simulation canvas ───────────────────────────────────────────

function GraphCanvas({ graph, selectedId, onSelect }: {
  graph: BrainGraph;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const simRef = useRef<Simulation<SimNode, SimEdge> | null>(null);
  const [, forceRerender] = useState<number>(0);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  // Snapshot the simulation state into refs so we can re-render without
  // resetting the simulation when only React state changes.
  const simState = useRef<{ nodes: SimNode[]; edges: SimEdge[] }>({ nodes: [], edges: [] });

  // Restart simulation when graph data changes (new threshold, new sync tick).
  useEffect(() => {
    const width = containerRef.current?.clientWidth ?? 800;
    const height = 560;
    const nodes: SimNode[] = graph.nodes.map((n) => ({
      ...n,
      x: width / 2 + (Math.random() - 0.5) * 200,
      y: height / 2 + (Math.random() - 0.5) * 200,
    }));
    const edges: SimEdge[] = graph.edges.map((e) => ({ ...e }));

    const sim = forceSimulation<SimNode>(nodes)
      .force('charge', forceManyBody<SimNode>().strength(-180))
      .force('link', forceLink<SimNode, SimEdge>(edges).id((n) => n.id).distance((e) => 60 + (1 - e.weight) * 80).strength((e) => 0.4 + e.weight * 0.5))
      .force('center', forceCenter(width / 2, height / 2))
      .force('collide', forceCollide<SimNode>((n) => n.size + 6))
      .alphaDecay(0.025);

    sim.on('tick', () => {
      simState.current = { nodes, edges };
      forceRerender((v) => v + 1);
    });

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [graph]);

  // Pan via mousedown/move; zoom via wheel.
  const onMouseDown = (e: React.MouseEvent): void => {
    if ((e.target as SVGElement).dataset.nodeId) return;
    panRef.current = { x: e.clientX, y: e.clientY, ox: view.x, oy: view.y };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!panRef.current) return;
      const dx = e.clientX - panRef.current.x;
      const dy = e.clientY - panRef.current.y;
      setView((v) => ({ ...v, x: panRef.current!.ox + dx, y: panRef.current!.oy + dy }));
    };
    const onUp = (): void => { panRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);
  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    setView((v) => ({ ...v, k: Math.max(0.3, Math.min(3, v.k * factor)) }));
  };

  // Resolve which IDs should be highlighted (hover/selection + neighbors).
  const activeId = hoverId ?? selectedId;
  const activeNeighbors = useMemo(() => {
    if (!activeId) return null;
    const s = new Set<string>([activeId]);
    for (const e of graph.edges) {
      const src = typeof e.source === 'string' ? e.source : (e.source as SimNode).id;
      const tgt = typeof e.target === 'string' ? e.target : (e.target as SimNode).id;
      if (src === activeId) s.add(tgt);
      if (tgt === activeId) s.add(src);
    }
    return s;
  }, [activeId, graph.edges]);

  const { nodes, edges } = simState.current;

  if (graph.nodeCount === 0) {
    return (
      <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--text-mute-dark)' }}>
        No learnings recorded for this project yet. The graph will appear as soon as the brain has memory.
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', height: 560, background: 'var(--surface-glass)' }}>
      <svg
        ref={ref}
        width="100%"
        height="100%"
        onMouseDown={onMouseDown}
        onWheel={onWheel}
        style={{ cursor: panRef.current ? 'grabbing' : 'grab', userSelect: 'none' }}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {/* Edges */}
          {edges.map((e, i) => {
            const src = typeof e.source === 'object' ? (e.source as SimNode) : null;
            const tgt = typeof e.target === 'object' ? (e.target as SimNode) : null;
            if (!src || !tgt) return null;
            const srcId = src.id;
            const tgtId = tgt.id;
            const active = activeNeighbors ? (activeNeighbors.has(srcId) && activeNeighbors.has(tgtId)) : false;
            const dim = activeNeighbors && !active;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke="var(--text-dark)"
                strokeWidth={0.4 + e.weight * 2}
                strokeOpacity={dim ? 0.05 : 0.15 + e.weight * 0.35}
              />
            );
          })}
          {/* Nodes */}
          {nodes.map((n) => {
            const isActive = activeId === n.id;
            const isNeighbor = activeNeighbors && activeNeighbors.has(n.id);
            const dim = activeNeighbors && !isNeighbor;
            return (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <circle
                  data-node-id={n.id}
                  r={n.size}
                  fill={colorFor(n.domain)}
                  stroke="var(--text-dark)"
                  strokeWidth={isActive ? 2.5 : 1}
                  opacity={dim ? 0.25 : 1}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId(null)}
                  onClick={(e) => { e.stopPropagation(); onSelect(n.id); }}
                  style={{ cursor: 'pointer', transition: 'opacity 120ms' }}
                />
                {(isActive || isNeighbor || n.size > 14) && (
                  <text
                    x={n.size + 4}
                    y={4}
                    fontSize={11}
                    fontWeight={isActive ? 600 : 500}
                    fill="var(--text-dark)"
                    opacity={dim ? 0 : 0.85}
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.label.length > 36 ? n.label.slice(0, 36) + '…' : n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      {/* Tiny controls (zoom hint) */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12,
        background: 'rgba(13, 13, 13, 0.65)', color: 'var(--text-light)',
        padding: '6px 10px', borderRadius: 'var(--radius-pill)',
        fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        Drag · scroll to zoom · click a node
      </div>
    </div>
  );
}

// ─── Detail side panel ─────────────────────────────────────────────────

function DetailPanel({ entry, node, onClose }: {
  entry: LearningEntry | null;
  node: GraphNode | null;
  onClose: () => void;
}) {
  return (
    <Card variant="neutral" padding="normal" style={{ minHeight: 560 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
        <Eyebrow>Selected node</Eyebrow>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'transparent', border: 'none',
            color: 'var(--text-mute-dark)',
            fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: 4,
          }}
        >×</button>
      </div>
      {!node ? (
        <div style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
            <span style={{
              width: 12, height: 12, borderRadius: 999,
              background: colorFor(node.domain),
              border: '1px solid var(--text-dark)',
            }} />
            <span style={{
              fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase',
              letterSpacing: '0.06em', color: 'var(--text-mute-dark)',
            }}>{node.domain}</span>
          </div>
          <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--size-h3)', marginBottom: 'var(--space-2)' }}>
            {node.label}
          </div>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'var(--space-3)', marginBottom: 'var(--space-4)',
            fontSize: 'var(--size-label)', color: 'var(--text-mute-dark)',
          }}>
            <div><strong style={{ color: 'var(--text-dark)' }} className="tabular">{node.accessCount}</strong> accesses</div>
            <div><strong style={{ color: 'var(--text-dark)' }} className="tabular">{node.tagCount}</strong> tags</div>
            <div className="tabular">{node.date}</div>
          </div>
          {entry?.lesson && (
            <Card variant="glass" radius="inner" padding="normal">
              <Eyebrow>Lesson</Eyebrow>
              <p style={{ margin: '8px 0 0', fontSize: 'var(--size-label)', lineHeight: 1.55, color: 'var(--text-dark)' }}>
                {entry.lesson.length > 600 ? entry.lesson.slice(0, 600) + '…' : entry.lesson}
              </p>
            </Card>
          )}
          {entry?.tags && entry.tags.length > 0 && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Eyebrow>Tags</Eyebrow>
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {entry.tags.map((t) => (
                  <span key={t} style={{
                    padding: '3px 10px',
                    border: '1px solid var(--hairline)',
                    borderRadius: 'var(--radius-pill)',
                    fontSize: 'var(--size-eyebrow)', color: 'var(--text-mute-dark)',
                    fontWeight: 'var(--weight-medium)',
                  }}>{t}</span>
                ))}
              </div>
            </div>
          )}
          {entry && (
            <a
              href={`#/p/${entry.id}`}
              style={{
                marginTop: 'var(--space-4)', display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 'var(--size-label)', fontWeight: 'var(--weight-semibold)',
                color: 'var(--text-dark)',
              }}
            >
              {/* Eventually: link to a per-learning detail route. For now,
                  the full lesson is visible above. */}
              Full entry id <code>{entry.id.slice(0, 8)}</code>
              <ArrowUpRight size={12} />
            </a>
          )}
        </>
      )}
    </Card>
  );
}
