import { useEffect, useMemo, useState } from 'react';
import { api, type AgentCommandSummary } from '../api/client';
import { useBrainSync } from '../api/useBrainSync';
import { Card, Eyebrow, StatNumber, ArrowUpRight, Loading, ErrorBanner } from '../components/Card';

const AGENT_LABEL: Record<AgentCommandSummary['agent'], string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  codex: 'Codex CLI',
  cline: 'Cline',
  continue: 'Continue',
  vscode: 'VS Code / Copilot',
};

const AGENT_COLOR: Record<AgentCommandSummary['agent'], string> = {
  'claude-code': 'var(--surface-dark)',
  cursor: 'var(--surface-mint)',
  codex: 'var(--surface-lavender)',
  cline: 'var(--surface-mint)',
  continue: 'var(--surface-lavender)',
  vscode: 'var(--surface-dark)',
};

export function CommandsView() {
  const [scanned, setScanned] = useState<string | null>(null);
  const [workspace, setWorkspace] = useState<string>('');
  const [commands, setCommands] = useState<AgentCommandSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<string>('');
  const sync = useBrainSync();

  useEffect(() => {
    api.commands()
      .then((r) => {
        setScanned(r.scannedAt);
        setWorkspace(r.workspace);
        setCommands(r.commands);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [sync.tick]);

  const filtered = useMemo(() => {
    if (!commands) return [];
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      (c.description?.toLowerCase().includes(q) ?? false) ||
      AGENT_LABEL[c.agent].toLowerCase().includes(q)
    );
  }, [commands, query]);

  const byAgent = useMemo(() => {
    const m: Record<string, number> = {};
    if (!commands) return m;
    for (const c of commands) m[c.agent] = (m[c.agent] ?? 0) + 1;
    return m;
  }, [commands]);

  if (error) return <ErrorBanner message={error} />;
  if (!commands) return <Loading />;

  return (
    <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div>
          <h1 style={{ fontSize: 'var(--size-h1)', fontWeight: 'var(--weight-bold)', margin: 0, letterSpacing: '-0.01em' }}>
            Agent commands
          </h1>
          <p style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', margin: '4px 0 0' }}>
            Knit composes with the slash commands you already wrote — pulls them from <code>.claude/commands/</code>,
            <code> .cursor/rules/</code>, <code>.clinerules/</code>, and friends, then suggests invocation when a
            protocol phase matches one of your commands.
          </p>
        </div>
        <SearchInput value={query} onChange={setQuery} />
      </header>

      {/* Stat strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gap: 'var(--space-4)' }}>
        <div style={{ gridColumn: 'span 5' }}>
          <Card variant="dark" padding="normal" style={{ minHeight: 130 }}>
            <Eyebrow style={{ color: 'var(--text-mute-light)' }}>Discovered</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)' }}>
              <StatNumber>{commands.length}</StatNumber>
            </div>
            <div style={{ marginTop: 6, fontSize: 'var(--size-label)', color: 'var(--text-mute-light)' }}>
              across {Object.keys(byAgent).length} agent{Object.keys(byAgent).length === 1 ? '' : 's'}
            </div>
          </Card>
        </div>
        <div style={{ gridColumn: 'span 7' }}>
          <Card variant="neutral" padding="normal" style={{ minHeight: 130 }}>
            <Eyebrow>By agent</Eyebrow>
            <div style={{ marginTop: 'var(--space-3)', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(byAgent).sort((a, b) => b[1] - a[1]).map(([agent, count]) => (
                <span key={agent} style={{
                  padding: '6px 12px',
                  background: AGENT_COLOR[agent as AgentCommandSummary['agent']],
                  color: agent === 'claude-code' || agent === 'vscode' ? 'var(--text-light)' : 'var(--text-dark)',
                  borderRadius: 'var(--radius-pill)',
                  fontSize: 'var(--size-label)',
                  fontWeight: 'var(--weight-medium)',
                }}>
                  {AGENT_LABEL[agent as AgentCommandSummary['agent']]} <span style={{ opacity: 0.6 }}>×{count}</span>
                </span>
              ))}
              {Object.keys(byAgent).length === 0 && (
                <span style={{ color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
                  No agent slash commands found yet. Drop a Markdown file in any agent&apos;s command directory
                  (e.g. <code>.claude/commands/test.md</code>) and refresh.
                </span>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Command list */}
      <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
        {filtered.map((c) => (
          <CommandRow key={`${c.agent}:${c.sourcePath}`} cmd={c} />
        ))}
        {filtered.length === 0 && commands.length > 0 && (
          <Card variant="neutral" padding="normal">
            <p style={{ margin: 0, color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)' }}>
              No commands match &quot;{query}&quot;.
            </p>
          </Card>
        )}
      </div>

      {/* Footer */}
      <div style={{ fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute-dark)', textAlign: 'center', paddingTop: 'var(--space-3)' }}>
        Scanned {scanned ? new Date(scanned).toLocaleString() : '—'} · workspace {workspace.replace(/^.*\//, '…/')}
      </div>
    </div>
  );
}

function SearchInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Search by name, description, agent…"
      style={{
        background: 'var(--surface-glass)',
        border: '1px solid var(--hairline)',
        color: 'var(--text-dark)',
        padding: '10px 14px',
        borderRadius: 'var(--radius-pill)',
        width: 320,
        maxWidth: '50vw',
        fontSize: 'var(--size-label)',
        fontFamily: 'var(--font-sans)',
        outline: 'none',
      }}
    />
  );
}

function CommandRow({ cmd }: { cmd: AgentCommandSummary }) {
  return (
    <Card variant="neutral" padding="normal">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <span style={{
              padding: '2px 10px',
              background: AGENT_COLOR[cmd.agent],
              color: cmd.agent === 'claude-code' || cmd.agent === 'vscode' ? 'var(--text-light)' : 'var(--text-dark)',
              borderRadius: 'var(--radius-pill)',
              fontSize: 'var(--size-eyebrow)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              fontWeight: 'var(--weight-semibold)',
            }}>
              {AGENT_LABEL[cmd.agent]}
            </span>
            <code style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)' }}>/{cmd.name}</code>
          </div>
          {cmd.description && (
            <p style={{ margin: 0, color: 'var(--text-mute-dark)', fontSize: 'var(--size-label)', lineHeight: 1.55 }}>
              {cmd.description}
            </p>
          )}
          <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--size-eyebrow)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-mute-dark)' }}>
            <code>{cmd.sourcePath.replace(/^.*\/(\.[^/]+\/[^/]+)\//, '$1/')}</code>
          </div>
        </div>
        <ArrowUpRight size={14} />
      </div>
    </Card>
  );
}
