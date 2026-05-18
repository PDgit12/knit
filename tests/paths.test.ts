import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  knitRoot,
  projectDataDir,
  knowledgePath,
  knowledgebasePath,
  teamsPath,
  sessionsJsonlPath,
  learningsDir,
  learningsFilePath,
  sessionsLogPath,
  legacyClaudeDir,
  legacyKnowledgePath,
  legacyKnowledgebasePath,
  legacyTeamsPath,
  legacyLearningsDir,
  migrationBreadcrumbPath,
  projectAgentFile,
} from '../src/engine/paths.js';

describe('paths', () => {
  const PROJECT = '/Users/test/my-project';

  beforeEach(() => {
    delete process.env.KNIT_HOME;
  });
  afterEach(() => {
    delete process.env.KNIT_HOME;
  });

  describe('knitRoot', () => {
    it('defaults to ~/.knit', () => {
      expect(knitRoot()).toBe(join(homedir(), '.knit'));
    });

    it('honors KNIT_HOME override', () => {
      process.env.KNIT_HOME = '/custom/engram';
      expect(knitRoot()).toBe('/custom/engram');
    });
  });

  describe('centralized paths', () => {
    beforeEach(() => { process.env.KNIT_HOME = '/tmp/eng'; });

    it('projectDataDir composes knitRoot + projects + hash', () => {
      expect(projectDataDir(PROJECT)).toMatch(/^\/tmp\/eng\/projects\/[a-f0-9]{16}$/);
    });

    it('knowledgePath puts knowledge.json under project dir', () => {
      expect(knowledgePath(PROJECT)).toBe(join(projectDataDir(PROJECT), 'knowledge.json'));
    });

    it('knowledgebasePath puts knowledgebase.json under project dir', () => {
      expect(knowledgebasePath(PROJECT)).toBe(join(projectDataDir(PROJECT), 'knowledgebase.json'));
    });

    it('teamsPath puts teams.json under project dir', () => {
      expect(teamsPath(PROJECT)).toBe(join(projectDataDir(PROJECT), 'teams.json'));
    });

    it('sessionsJsonlPath puts sessions.jsonl under project dir', () => {
      expect(sessionsJsonlPath(PROJECT)).toBe(join(projectDataDir(PROJECT), 'sessions.jsonl'));
    });

    it('learningsDir nests under project dir', () => {
      expect(learningsDir(PROJECT)).toBe(join(projectDataDir(PROJECT), 'learnings'));
    });

    it('learningsFilePath slugifies project name', () => {
      expect(learningsFilePath(PROJECT, 'My Cool Project!'))
        .toBe(join(learningsDir(PROJECT), 'my-cool-project-.md'));
    });

    it('sessionsLogPath lives under learningsDir', () => {
      expect(sessionsLogPath(PROJECT)).toBe(join(learningsDir(PROJECT), 'sessions.md'));
    });
  });

  describe('legacy paths', () => {
    it('legacyClaudeDir points at <project>/.claude', () => {
      expect(legacyClaudeDir(PROJECT)).toBe(join(PROJECT, '.claude'));
    });
    it('legacyKnowledgePath stays under project /.claude', () => {
      expect(legacyKnowledgePath(PROJECT)).toBe(join(PROJECT, '.claude/knowledge.json'));
    });
    it('legacyKnowledgebasePath stays under project /.claude', () => {
      expect(legacyKnowledgebasePath(PROJECT)).toBe(join(PROJECT, '.claude/knowledgebase.json'));
    });
    it('legacyTeamsPath stays under project /.claude', () => {
      expect(legacyTeamsPath(PROJECT)).toBe(join(PROJECT, '.claude/teams.json'));
    });
    it('legacyLearningsDir stays under project /.claude/learnings', () => {
      expect(legacyLearningsDir(PROJECT)).toBe(join(PROJECT, '.claude/learnings'));
    });
    it('migrationBreadcrumbPath lives in the legacy .claude dir', () => {
      expect(migrationBreadcrumbPath(PROJECT)).toBe(join(PROJECT, '.claude/MIGRATED.txt'));
    });
  });

  describe('projectAgentFile', () => {
    it('composes engram-<name>.md for a bare name', () => {
      expect(projectAgentFile(PROJECT, 'typescript-pro'))
        .toBe(join(PROJECT, '.claude/agents/knit-typescript-pro.md'));
    });
    it('strips a leading engram- prefix to avoid double-prefixing', () => {
      expect(projectAgentFile(PROJECT, 'knit-typescript-pro'))
        .toBe(join(PROJECT, '.claude/agents/knit-typescript-pro.md'));
    });
  });

  it('all centralized paths are inside knitRoot', () => {
    process.env.KNIT_HOME = '/tmp/eng';
    const root = knitRoot();
    expect(projectDataDir(PROJECT).startsWith(root)).toBe(true);
    expect(knowledgePath(PROJECT).startsWith(root)).toBe(true);
    expect(knowledgebasePath(PROJECT).startsWith(root)).toBe(true);
    expect(teamsPath(PROJECT).startsWith(root)).toBe(true);
    expect(sessionsJsonlPath(PROJECT).startsWith(root)).toBe(true);
    expect(learningsDir(PROJECT).startsWith(root)).toBe(true);
  });
});
