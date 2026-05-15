import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { join, relative, extname, basename, dirname } from 'node:path';
import type {
  ProjectKnowledge,
  KnowledgeSummary,
  FileEntry,
  ExportEntry,
  TestMapping,
  ProjectScan,
} from './types.js';

/** Directories to always skip */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', '__pycache__', '.venv', 'venv',
  'dist', 'build', 'out', '.claude', 'coverage', '.turbo', '.cache',
  'target', 'vendor', 'pkg', 'bin',
]);

/** Source file extensions worth indexing */
const SOURCE_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.java', '.kt', '.swift',
  '.vue', '.svelte',
]);

/** Test file patterns */
const TEST_PATTERNS = [
  /\.test\.\w+$/,
  /\.spec\.\w+$/,
  /_test\.\w+$/,
  /^test_/,
  /\.tests\.\w+$/,
];

/**
 * Build a complete knowledge index for a project.
 * Zero external dependencies — uses only fs + path + regex.
 */
export function buildKnowledge(rootPath: string, _scan: ProjectScan): ProjectKnowledge {
  const files = walkFiles(rootPath, rootPath);
  const sourceFiles = files.filter((f) => SOURCE_EXTS.has(f.extension));
  const importGraph = buildImportGraph(rootPath, sourceFiles);
  const exports = buildExportMap(rootPath, sourceFiles);
  const testMap = buildTestMap(sourceFiles, importGraph);
  const summary = buildSummary(files, sourceFiles, importGraph, testMap, rootPath);

  return {
    generatedAt: new Date().toISOString(),
    summary,
    files,
    importGraph,
    exports,
    testMap,
  };
}

// ── File Walking ─────────────────────────────────────────────────

function walkFiles(rootPath: string, dir: string): FileEntry[] {
  const entries: FileEntry[] = [];

  let items: string[];
  try {
    items = readdirSync(dir);
  } catch {
    return entries;
  }

  for (const item of items) {
    if (item.startsWith('.') && item !== '.') continue;
    if (SKIP_DIRS.has(item)) continue;

    const fullPath = join(dir, item);
    let stat;
    try {
      // Use lstat to detect symlinks without following them
      const lstat = lstatSync(fullPath);
      if (lstat.isSymbolicLink()) continue; // skip symlinks to prevent infinite loops
      stat = lstat;
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      entries.push(...walkFiles(rootPath, fullPath));
    } else if (stat.isFile()) {
      const ext = extname(item);
      if (!SOURCE_EXTS.has(ext)) continue;

      const relPath = relative(rootPath, fullPath);
      let lines = 0;
      try {
        const content = readFileSync(fullPath, 'utf-8');
        lines = content.split('\n').length;
      } catch {
        // skip unreadable files
      }

      entries.push({
        path: relPath,
        extension: ext,
        lines,
        sizeBytes: stat.size,
      });
    }
  }

  return entries;
}

// ── Import Graph ─────────────────────────────────────────────────

/** Regex patterns for extracting imports by language */
const IMPORT_PATTERNS: Array<{ ext: Set<string>; patterns: RegExp[] }> = [
  {
    // TypeScript / JavaScript
    ext: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte']),
    patterns: [
      /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /export\s+.*?\s+from\s+['"]([^'"]+)['"]/g,
    ],
  },
  {
    // Python
    ext: new Set(['.py']),
    patterns: [
      /^from\s+(\S+)\s+import/gm,
      /^import\s+(\S+)/gm,
    ],
  },
  {
    // Go
    ext: new Set(['.go']),
    patterns: [
      /import\s+"([^"]+)"/g,
      /import\s+\w+\s+"([^"]+)"/g,
    ],
  },
  {
    // Rust
    ext: new Set(['.rs']),
    patterns: [
      /use\s+(crate::\S+)/g,
      /mod\s+(\w+)/g,
    ],
  },
];

function buildImportGraph(rootPath: string, files: FileEntry[]): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  const fileSet = new Set(files.map((f) => f.path));

  for (const file of files) {
    const fullPath = join(rootPath, file.path);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const imports: string[] = [];
    const langPatterns = IMPORT_PATTERNS.find((lp) => lp.ext.has(file.extension));
    if (!langPatterns) continue;

    for (const pattern of langPatterns.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(content)) !== null) {
        const raw = match[1];
        if (!raw) continue;

        // Skip external packages (no relative path)
        if (!raw.startsWith('.') && !raw.startsWith('/')) continue;

        // Resolve to relative path
        const resolved = resolveImport(file.path, raw, fileSet);
        if (resolved) {
          imports.push(resolved);
        }
      }
    }

    if (imports.length > 0) {
      graph[file.path] = [...new Set(imports)];
    }
  }

  return graph;
}

/** Resolve a relative import to a file in the project */
function resolveImport(fromFile: string, importPath: string, fileSet: Set<string>): string | null {
  const dir = dirname(fromFile);
  const base = join(dir, importPath).replace(/\\/g, '/');

  // Try exact match
  if (fileSet.has(base)) return base;

  // Strip .js/.mjs/.cjs extension and try .ts/.tsx (common in TS projects with ESM)
  const stripped = base.replace(/\.(js|mjs|cjs)$/, '');
  if (stripped !== base) {
    for (const tsExt of ['.ts', '.tsx']) {
      if (fileSet.has(stripped + tsExt)) return stripped + tsExt;
    }
  }

  // Try with common extensions
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.go', '.rs'];
  for (const ext of extensions) {
    const withExt = base + ext;
    if (fileSet.has(withExt)) return withExt;
  }

  // Try index files
  for (const ext of extensions) {
    const indexPath = join(base, `index${ext}`).replace(/\\/g, '/');
    if (fileSet.has(indexPath)) return indexPath;
  }

  return null;
}

// ── Export Map ────────────────────────────────────────────────────

const EXPORT_PATTERNS: Array<{ ext: Set<string>; patterns: Array<{ regex: RegExp; kind: ExportEntry['kind'] }> }> = [
  {
    ext: new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']),
    patterns: [
      { regex: /^export\s+function\s+(\w+)/gm, kind: 'function' },
      { regex: /^export\s+async\s+function\s+(\w+)/gm, kind: 'function' },
      { regex: /^export\s+class\s+(\w+)/gm, kind: 'class' },
      { regex: /^export\s+interface\s+(\w+)/gm, kind: 'interface' },
      { regex: /^export\s+type\s+(\w+)/gm, kind: 'type' },
      { regex: /^export\s+const\s+(\w+)/gm, kind: 'const' },
      { regex: /^export\s+default\s+(?:function|class)\s+(\w+)/gm, kind: 'default' },
    ],
  },
  {
    ext: new Set(['.py']),
    patterns: [
      { regex: /^def\s+(\w+)\s*\(/gm, kind: 'function' },
      { regex: /^class\s+(\w+)/gm, kind: 'class' },
    ],
  },
  {
    ext: new Set(['.go']),
    patterns: [
      // Go exports are capitalized functions/types
      { regex: /^func\s+([A-Z]\w*)/gm, kind: 'function' },
      { regex: /^type\s+([A-Z]\w*)\s+struct/gm, kind: 'type' },
      { regex: /^type\s+([A-Z]\w*)\s+interface/gm, kind: 'interface' },
    ],
  },
  {
    ext: new Set(['.rs']),
    patterns: [
      { regex: /^pub\s+fn\s+(\w+)/gm, kind: 'function' },
      { regex: /^pub\s+struct\s+(\w+)/gm, kind: 'type' },
      { regex: /^pub\s+trait\s+(\w+)/gm, kind: 'interface' },
      { regex: /^pub\s+enum\s+(\w+)/gm, kind: 'type' },
    ],
  },
];

function buildExportMap(rootPath: string, files: FileEntry[]): Record<string, ExportEntry[]> {
  const exportMap: Record<string, ExportEntry[]> = {};

  for (const file of files) {
    if (isTestFile(file.path)) continue;

    const fullPath = join(rootPath, file.path);
    let content: string;
    try {
      content = readFileSync(fullPath, 'utf-8');
    } catch {
      continue;
    }

    const langPatterns = EXPORT_PATTERNS.find((lp) => lp.ext.has(file.extension));
    if (!langPatterns) continue;

    const exports: ExportEntry[] = [];

    for (const { regex, kind } of langPatterns.patterns) {
      const re = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = re.exec(content)) !== null) {
        const name = match[1];
        if (!name) continue;

        // Find line number
        const beforeMatch = content.substring(0, match.index);
        const lineNum = beforeMatch.split('\n').length;

        exports.push({ name, kind, line: lineNum });
      }
    }

    if (exports.length > 0) {
      exportMap[file.path] = exports;
    }
  }

  return exportMap;
}

// ── Test Mapping ─────────────────────────────────────────────────

function isTestFile(filePath: string): boolean {
  const name = basename(filePath);
  return TEST_PATTERNS.some((p) => p.test(name)) || filePath.includes('/tests/') || filePath.includes('/__tests__/') || filePath.includes('/test/');
}

function buildTestMap(files: FileEntry[], importGraph: Record<string, string[]>): TestMapping {
  const testFiles = files.filter((f) => isTestFile(f.path)).map((f) => f.path);
  const sourceFiles = files.filter((f) => !isTestFile(f.path)).map((f) => f.path);

  const tested: Record<string, string[]> = {};

  for (const testFile of testFiles) {
    // Strategy 1: naming convention (foo.test.ts → foo.ts)
    const testName = basename(testFile);
    const sourceName = testName
      .replace(/\.test\./, '.')
      .replace(/\.spec\./, '.')
      .replace(/_test\./, '.')
      .replace(/\.tests\./, '.');

    for (const src of sourceFiles) {
      if (basename(src) === sourceName) {
        if (!tested[src]) tested[src] = [];
        tested[src].push(testFile);
      }
    }

    // Strategy 2: import analysis — what does this test file import?
    const imports = importGraph[testFile] || [];
    for (const imp of imports) {
      if (sourceFiles.includes(imp)) {
        if (!tested[imp]) tested[imp] = [];
        if (!tested[imp].includes(testFile)) {
          tested[imp].push(testFile);
        }
      }
    }
  }

  const untested = sourceFiles.filter((src) => !tested[src]);

  return { tested, untested, testFiles };
}

// ── Summary ──────────────────────────────────────────────────────

function buildSummary(
  allFiles: FileEntry[],
  sourceFiles: FileEntry[],
  importGraph: Record<string, string[]>,
  testMap: TestMapping,
  rootPath: string,
): KnowledgeSummary {
  // Language breakdown
  const languageBreakdown: Record<string, number> = {};
  for (const file of allFiles) {
    const ext = file.extension || 'other';
    languageBreakdown[ext] = (languageBreakdown[ext] || 0) + 1;
  }

  // High fanout — count how many files import each file
  const importedBy: Record<string, number> = {};
  for (const [_importer, imports] of Object.entries(importGraph)) {
    for (const imp of imports) {
      importedBy[imp] = (importedBy[imp] || 0) + 1;
    }
  }
  const highFanoutFiles = Object.entries(importedBy)
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([file]) => file);

  // Entry points
  const entryPoints: string[] = [];
  try {
    const pkgPath = join(rootPath, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      if (pkg.main) entryPoints.push(pkg.main);
      if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin) as string[];
        entryPoints.push(...bins);
      }
    }
  } catch {
    // skip
  }
  // Also detect index files at root src/
  for (const file of sourceFiles) {
    if (/^(src\/)?index\.\w+$/.test(file.path)) {
      if (!entryPoints.includes(file.path)) entryPoints.push(file.path);
    }
  }

  // Largest files
  const largestFiles = [...sourceFiles]
    .filter((f) => !isTestFile(f.path))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 10)
    .map((f) => ({ path: f.path, lines: f.lines }));

  return {
    totalFiles: allFiles.length,
    totalLines: allFiles.reduce((sum, f) => sum + f.lines, 0),
    languageBreakdown,
    entryPoints,
    highFanoutFiles,
    untestedFiles: testMap.untested,
    largestFiles,
  };
}
