# Project Learnings — Engram

> Recursive learning log. Check this BEFORE starting any task.
> Grep by `#tag` to find relevant lessons for the domain you're working in.

---

## 2026-05-15 Project bootstrapped — workflow adapted from purdue-copr-intake
**Domain(s):** All — workflow infrastructure
**Approach:** Adapted the v2.0 Orchestration Protocol from purdue-copr-intake to engram. 5 domains: CLI, Engine, Generators, Adapters, QA. Same 6-phase protocol, same LEARN enforcement, same token discipline. Hooks: destructive git blocking, TypeScript post-edit typecheck, stop-hook build verification + session capture.
**Outcome:** Success — full workflow infrastructure in place before first line of product code
**Lesson:** The workflow is the product here — we're building the tool that automates what this CLAUDE.md does manually. Every friction point we hit while using this workflow is a feature insight for the product.
**Tags:** #workflow #all #bootstrap

## 2026-05-15 Product insight — the workflow IS the spec
**Domain(s):** Engine, Generators
**Approach:** The purdue-copr-intake CLAUDE.md + .claude/ directory IS the reference implementation for what `engram init` should generate. Every section maps to a generator output.
**Outcome:** N/A — insight, not implementation
**Lesson:** When building generators, always diff the output against the purdue reference. If the generated CLAUDE.md wouldn't work as well as the hand-built one, we haven't shipped yet.
**Tags:** #engine #generators #product-insight

## 2026-05-15 Knowledge brain built — zero-dep static analysis engine
**Domain(s):** Engine, Generators, CLI, QA
**Approach:** Built src/engine/knowledge.ts (300 lines) — walks files, extracts imports via regex (TS/JS/Python/Go/Rust), maps exports, builds test coverage mapping, identifies high-fanout files and untested files. Stores as .claude/knowledge.json. Injects Project Map into CLAUDE.md. Added to init command flow.
**Outcome:** Success — 19 knowledge tests pass, import graph resolves .js→.ts extensions, export extraction works for functions/classes/interfaces/types/consts
**Lesson:** The .js→.ts import resolution was critical — TypeScript ESM projects use `import from './foo.js'` but the actual file is `foo.ts`. Added extension stripping/remapping in resolveImport(). Without this, most TS import graphs would be empty.
**Tags:** #engine #knowledge #import-graph

## 2026-05-15 Token discipline replaced with honest effort scaling
**Domain(s):** Generators
**Approach:** Replaced "Token Discipline" section (fake numbers like "~5-8k tokens") with "Effort Scaling" using observable proxy metrics (files touched, agents spawned, phases). Removed "~100-300k/session savings" marketing line from CLI output. Replaced with actual knowledge stats.
**Outcome:** Success — no fake numbers anywhere in generated output
**Lesson:** Never put unmeasurable claims in generated output. If you can't count it, don't quote a number. Use proxy metrics that agents can actually observe (files touched, agents spawned) instead of token counts we can't measure.
**Tags:** #generators #effort-scaling #honesty

## 2026-05-15 False positives auto-injected into CLAUDE.md
**Domain(s):** Generators, Engine
**Approach:** generateClaudeMd now accepts optional falsePositives param. init command reads learnings files, calls findFalsePositives(), passes results to generator. When false positives exist, a "Known False Positives" section appears in CLAUDE.md so agents see them without grepping.
**Outcome:** Success — tested with mock data, section renders correctly
**Lesson:** The findFalsePositives() function existed from day 1 but nothing called it. Always wire up utility functions to the actual product flow, not just tests.
**Tags:** #generators #engine #false-positive

## 2026-05-15 refresh command added
**Domain(s):** CLI, Engine, Generators
**Approach:** New `engram refresh` command — re-scans project, rebuilds knowledge, re-extracts false positives, regenerates CLAUDE.md + knowledge.json. Keeps the brain current as the project evolves.
**Outcome:** Success — compiles and wired into CLI
**Lesson:** The refresh command is essential for the product story — init sets up once, refresh keeps it current. Without refresh, the knowledge.json goes stale after the first day.
**Tags:** #cli #engine #generators

## 2026-05-15 Followed the workflow properly for first time on this project
**Domain(s):** All — workflow infrastructure
**Approach:** User called out that I wasn't following the protocol. Did proper pre-flight (learnings check, tool availability), classified as Complex (3+ domains), entered plan mode, did RESEARCH with explore agents (brutal audit of what's real vs theater), IDEATE with plan agent, wrote formal plan file, got approval, then executed.
**Outcome:** Success — the audit revealed 70% of the generated output was aspirational prose. Built the knowledge brain, replaced fake token numbers, wired false positives.
**Lesson:** ALWAYS follow the protocol. The user built it for a reason — the pre-flight catch saves re-work, the classification prevents over/under-engineering, and the LEARN phase prevents context loss. Skipping the protocol while building the protocol tool is the worst possible look.
**Tags:** #workflow #all #meta-lesson
