/**
 * `knit ui` — launches the local Knit dashboard.
 *
 * v1.0-alpha doorway. The ONLY terminal command the user touches in normal
 * operation: starts a local HTTP server reading ~/.knit/ and opens the
 * default browser. Everything else (setup, status, refresh, install-agents,
 * doctor, export) eventually moves into webapp screens — those CLI commands
 * stay for now as deprecated fallbacks until the webapp has feature parity.
 *
 * Local-first invariants honored:
 *   - Server binds to 127.0.0.1 only (no LAN exposure)
 *   - No auth (your machine, your data)
 *   - No outbound network calls
 *   - Reads ~/.knit/projects/<hash>/* and ~/.knit/global/* directly
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { exec } from 'node:child_process';

import { knitRoot } from '../engine/paths.js';
import { VERSION } from '../version.js';

const HOST = '127.0.0.1';
const DEFAULT_PORT = 7421;

interface ProjectSummary {
  id: string;
  name: string;
  learningCount: number;
  sessionCount: number;
  lastActive: string | null;
}

interface BrainSummary {
  projectCount: number;
  totalLearnings: number;
  globalLearnings: number;
  knitVersion: string;
  knitHome: string;
}

function listProjects(): ProjectSummary[] {
  const root = join(knitRoot(), 'projects');
  if (!existsSync(root)) return [];
  const projects: ProjectSummary[] = [];
  for (const id of readdirSync(root)) {
    const dir = join(root, id);
    try {
      if (!statSync(dir).isDirectory()) continue;
    } catch {
      continue;
    }
    const kbPath = join(dir, 'knowledgebase.json');
    const sessPath = join(dir, 'sessions.jsonl');
    let name = id;
    let learningCount = 0;
    let lastActive: string | null = null;
    try {
      if (existsSync(kbPath)) {
        const kb = JSON.parse(readFileSync(kbPath, 'utf-8')) as {
          projectName?: string;
          entries?: { date?: string }[];
        };
        name = kb.projectName || id;
        learningCount = Array.isArray(kb.entries) ? kb.entries.length : 0;
        if (kb.entries && kb.entries.length > 0) {
          const dates = kb.entries
            .map((e) => e.date)
            .filter((d): d is string => typeof d === 'string')
            .sort();
          lastActive = dates.at(-1) ?? null;
        }
      }
    } catch {
      /* unreadable kb — surface project with default counts */
    }
    let sessionCount = 0;
    try {
      if (existsSync(sessPath)) {
        const lines = readFileSync(sessPath, 'utf-8').split('\n').filter(Boolean);
        sessionCount = lines.length;
      }
    } catch {
      /* unreadable sessions */
    }
    projects.push({ id, name, learningCount, sessionCount, lastActive });
  }
  return projects.sort((a, b) => (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

function countGlobalLearnings(): number {
  const path = join(knitRoot(), 'global', 'learnings.jsonl');
  if (!existsSync(path)) return 0;
  try {
    return readFileSync(path, 'utf-8').split('\n').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function brainSummary(): BrainSummary {
  const projects = listProjects();
  return {
    projectCount: projects.length,
    totalLearnings: projects.reduce((sum, p) => sum + p.learningCount, 0),
    globalLearnings: countGlobalLearnings(),
    knitVersion: VERSION,
    knitHome: knitRoot().replace(homedir(), '~'),
  };
}

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function notFound(res: ServerResponse): void {
  jsonResponse(res, 404, { error: 'Not found' });
}

function serveStatic(req: IncomingMessage, res: ServerResponse, webappDist: string): void {
  const urlPath = (req.url || '/').split('?')[0];
  const safePath = urlPath === '/' ? '/index.html' : urlPath;
  // Resolve against webappDist; prevent traversal by re-joining + checking prefix.
  const fullPath = resolve(webappDist, '.' + safePath);
  if (!fullPath.startsWith(resolve(webappDist))) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  if (!existsSync(fullPath)) {
    // SPA fallback for client-side routes.
    const indexPath = join(webappDist, 'index.html');
    if (existsSync(indexPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(indexPath));
      return;
    }
    res.writeHead(404); res.end('Not found'); return;
  }
  const ext = fullPath.split('.').pop()?.toLowerCase() ?? '';
  const mime: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    css: 'text/css; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml',
    png: 'image/png',
    ico: 'image/x-icon',
  };
  res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
  res.end(readFileSync(fullPath));
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? `open "${url}"`
    : process.platform === 'win32' ? `start "" "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      process.stderr.write(`[knit ui] Could not auto-open browser. Open manually: ${url}\n`);
    }
  });
}

export async function uiCommand(): Promise<void> {
  // Locate the built webapp bundle. In dev: <repo>/webapp/dist.
  // In an npm-installed package: <package>/dist/webapp.
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../webapp/dist'),     // dev: src/commands/ui.ts -> ../../webapp/dist
    resolve(here, '../webapp'),              // installed: dist/commands/ui.js -> ../webapp
    resolve(here, '../../dist/webapp'),      // alt installed
  ];
  const webappDist = candidates.find((p) => existsSync(join(p, 'index.html')));
  if (!webappDist) {
    process.stderr.write(
      '[knit ui] Webapp bundle not found. Looked in:\n' +
      candidates.map((c) => '  ' + c).join('\n') + '\n' +
      'If you cloned from source, run: cd webapp && npm install && npm run build\n',
    );
    process.exit(1);
  }

  const port = parseInt(process.env.KNIT_UI_PORT || '', 10) || DEFAULT_PORT;

  const server = createServer((req, res) => {
    const url = req.url || '/';
    // API surface — local-first, read-only in v1.0-alpha.
    if (url.startsWith('/api/')) {
      try {
        if (url === '/api/brain/summary') return jsonResponse(res, 200, brainSummary());
        if (url === '/api/projects') return jsonResponse(res, 200, { projects: listProjects() });
        return notFound(res);
      } catch (err) {
        return jsonResponse(res, 500, {
          error: 'Server error reading brain',
          detail: (err as Error).message,
        });
      }
    }
    // Static files (the React bundle) — SPA fallback to index.html.
    serveStatic(req, res, webappDist);
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST}:${port}/`;
    process.stdout.write(
      `\nKnit Dashboard — http://${HOST}:${port}\n` +
      `Reading from: ${knitRoot()}\n` +
      `Press Ctrl-C to stop.\n\n`,
    );
    openBrowser(url);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(
        `[knit ui] Port ${port} already in use. Set KNIT_UI_PORT=<port> to override.\n`,
      );
      process.exit(1);
    }
    process.stderr.write(`[knit ui] Server error: ${err.message}\n`);
    process.exit(1);
  });
}
