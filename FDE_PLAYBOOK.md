# Forward-Deployed Engineer Playbook — 3-Month Sprint

> A college sophomore's plan to land an FDE-track role (Palantir / Decagon / Sierra / Cognition / Anthropic-Solutions) by Aug 2026, using Knit as the artifact.

---

## Table of contents

1. [What an FDE actually is](#1-what-an-fde-actually-is)
2. [The 3-month plan, week by week](#2-the-3-month-plan-week-by-week)
3. [Knit's architecture, explained like an interviewer will ask](#3-knits-architecture-explained-like-an-interviewer-will-ask)
4. [MCP deep-dive — the protocol, the patterns, the pitfalls](#4-mcp-deep-dive--the-protocol-the-patterns-the-pitfalls)
5. [System design fundamentals you actually need](#5-system-design-fundamentals-you-actually-need)
6. [AI/ML curriculum — from the start, deeply](#6-aiml-curriculum--from-the-start-deeply)
7. [Interview Q&A bank with real answers](#7-interview-qa-bank-with-real-answers)
8. [Practice problems, ranked](#8-practice-problems-ranked)
9. [The mini-project: Knit-Agents drift detector](#9-the-mini-project-knit-agents-drift-detector)
10. [Daily practice routine](#10-daily-practice-routine)
11. [Reading list — what's actually worth your time](#11-reading-list--whats-actually-worth-your-time)

---

## 1. What an FDE actually is

A Forward-Deployed Engineer is the engineer who **goes to the customer's office**, builds whatever's needed in production, talks to the customer's leadership, and ships fast enough that the customer renews. Three threads braided together:

| Thread | What it looks like daily | How Knit prepares you for it |
|---|---|---|
| **Customer empathy** | Sit with a user, watch them suffer, identify the *real* pain (not the one in the ticket) | Every Knit user's session is a teacher — you watch what they actually do with your MCP server |
| **Engineering breadth** | Write backend Python today, debug a SQL query tomorrow, fix a frontend bug Thursday, design a data pipeline Friday | Knit already spans CLI / MCP server / engine / generators / tests — you're already doing it |
| **Judgment under ambiguity** | Pick the right abstraction with incomplete info; know when "good enough" is the right call vs. when to push back | Every Knit release is a judgment call: ship v0.9 with `Record<string,string>` or block on the schema refactor? You're already practicing this |

### The FDE profile interviewers screen for

1. **Ships under pressure.** Public artifact with iteration history. Knit's v0.1 → v0.9 cadence (10+ releases in months) is exactly this signal.
2. **Customer-first instinct.** Can you describe a problem from the user's POV, not the engineer's? Practice this — every Knit feature has a "why" rooted in a real Claude Code session that failed.
3. **Reads code fast.** They will hand you an unfamiliar repo and watch. Knit's `code-explorer` agent + your habit of reading the engine before editing is the muscle they're looking for.
4. **Communicates terse-and-clear.** Senior engineers don't pad. Write your commit messages, PR descriptions, and Loom narrations like every word costs $5.
5. **Owns end-to-end.** From "this is broken" through "I shipped a fix and verified it in prod." Knit's REVIEW → LEARN cycle is this same loop.

### Anti-patterns interviewers screen out

- "I built a CRUD app following a tutorial." (No judgment shown.)
- Leetcode-only profile. (Algorithms are table stakes, not differentiators.)
- Long explanations to simple questions. (Says you talk past the customer.)
- Defensive when challenged on a decision. (Says you can't update beliefs.)

---

## 2. The 3-month plan, week by week

Today: **May 20, 2026**. Target: at least one offer (Palantir FDE intern OR equivalent agent-company eng) by **Aug 15, 2026**.

### Weeks 1–2: Set the foundation (May 20 – Jun 2)

**Knit work:**
- Land the CRITICAL fixes (C1/C2/C3/H4/M4 — already done in this session).
- Write the H6 migration test, H7 stdio integration test.
- Split `handlers.ts` (M1). Land error-envelope cleanup (M2).
- Tag and release **v0.9.1** (the "audit-driven hardening" release).

**Application work:**
- File Palantir FDE Internship 2026 application. Cover letter: 1 paragraph, lead with Knit, link the repo.
- Apply to 8 agent-company roles in parallel: Decagon, Sierra, Cognition, Cresta, Anthropic Solutions, Adept, MultiOn, Cursor.
- Get résumé reviewed by 2 senior engineers (find them in Discord / Twitter / cold email).

**Interview prep starts:**
- Solve 1 Leetcode-medium per day (45 min cap). Topics: arrays, strings, hashmaps, trees, graphs.
- Read *Designing Data-Intensive Applications* ch. 1–3 (foundations of reliability, replication, partitioning).
- Watch Karpathy's "Let's build GPT from scratch" (YouTube, ~2hr). Take notes.

### Weeks 3–4: Build the demo (Jun 3 – Jun 16)

**Knit-Agents alpha:** This is your interview centerpiece. See [§9](#9-the-mini-project-knit-agents-drift-detector) for the spec.
- Goal: a working drift detector for production Claude agents, deployable in 10 lines of code, with a measured before/after metric on a real agent.
- Don't perfect it. **Ship the ugly version first**, iterate based on one real user.

**One real customer:**
- Cold DM 15 founders of <50-person companies using Claude/MCP. Offer a 30-min Loom showing Knit on their repo.
- Convert one to a public reference. ("[Engineer] at [company] uses Knit to prevent agent drift.")

**Interview prep:**
- Leetcode-medium continues. Topics this week: dynamic programming, backtracking, two-pointer.
- *DDIA* ch. 4–6 (encoding, distributed data, partitioning).
- One mock system-design interview with a friend or paid service (Pramp/interviewing.io).

### Weeks 5–6: First-round interviews (Jun 17 – Jun 30)

**Knit work:**
- Land H1+H2 (typed MCP input schemas — the v1.0 breaking change). Release **v0.10**.
- Update README with v0.10 changes. Tweet the release.

**Interviews you should be in:**
- Palantir recruiter screen (usually 2-3 weeks after application).
- 2-3 agent companies in technical phone-screen rounds.

**Practice for what Palantir FDE actually asks:**
1. **Product-sense question.** "A customer says agent X is hallucinating 30% of the time. What do you ask first, and what do you do in the first hour?" (See [§7](#7-interview-qa-bank-with-real-answers) for a written answer.)
2. **Live coding.** Not leetcode — usually "parse this messy CSV and aggregate by X." Practice in Python + TypeScript both.
3. **System design lite.** "Design a service that ingests N MCP servers and lets users search across all their tools." This is Knit-Agents, basically.

### Weeks 7–8: Onsite preparation + Plan B (Jul 1 – Jul 14)

**Knit work:**
- Write a technical blog post: *"How we measured agent context drift across 10,000 production turns."*
- Submit to Hacker News on a Tuesday morning. Even a #20 post creates a recruiter inbound.

**Onsite prep:**
- Mock onsites with friends. 4 rounds: coding, system design, product/customer, behavioral.
- Memorize 3 deep stories from Knit:
  1. **A hard bug.** (The v0.7 → v0.8 BM25 migration — explain how you debugged drift in retrieval results.)
  2. **A decision you'd remake.** (Probably the v0.1 in-tree `.claude/` choice that v0.3 had to migrate away from.)
  3. **A user moment.** (Even if it's a friend trying Knit — what surprised you about how they used it?)

**Plan B activation:**
- If no Palantir movement yet, lean into the agent companies. Have offers in hand to give you negotiation leverage.

### Weeks 9–10: Onsites + AI/ML depth (Jul 15 – Jul 28)

**Knit work:** Tier 2 polish only. The product story has already won its battles by now.

**AI/ML deep dives:**
- Implement Karpathy's nano-GPT from scratch. Don't copy-paste. Type every line.
- Read the *Attention Is All You Need* paper. Then read it again 3 days later.
- Implement a tiny BM25 from scratch in Python — you'll understand Knit's `bm25.ts` 10× deeper.

**Onsites are happening.** Be honest, be specific, be terse.

### Weeks 11–12: Negotiation + Final push (Jul 29 – Aug 11)

**Offers should be in hand.** If not, the issue is application volume — apply to 20 more companies in week 11.

**Negotiation rules:**
1. Never accept on the call. "Thank you, I'd like to think it over and respond in 48 hours" — always.
2. Get any offer in writing before negotiating. Verbal-only is not real.
3. Mention competing interest *only when true.* ("I have one other process at final-round stage.")
4. Negotiate base + signing, not equity (you don't have leverage on equity as an intern).

**Aug 15 — pick the offer.** Even if it's not Palantir, the right answer is: take the role that puts you closest to real customers and real production agents. That's the FDE muscle. Palantir next summer, if not this one.

---

## 3. Knit's architecture, explained like an interviewer will ask

An FDE interviewer will say: *"Walk me through your project. What's the architecture? What was the hardest decision?"* You need a 90-second version and a 10-minute version.

### The 90-second version

> Knit is an MCP server — a Model Context Protocol server — that gives Claude Code persistent project memory. Three concerns: **memory** (learnings + sessions stored in `~/.knit/projects/<hash>/`), **tokens** (CLAUDE.md is 2KB instead of 16KB, with workflow protocol fetched on demand), and **workflow** (a 4-tier classification routes simple tasks through `EXECUTE→LEARN` and complex ones through `RESEARCH→IDEATE→PLAN→EXECUTE→OPTIMIZE→REVIEW`). The engine is pure TypeScript, zero external deps for the knowledge brain. 43 MCP tools, 506 tests. The hard decision was the v0.3 move from in-tree `.claude/` to centralized `~/.knit/`: it forced a migration path I had to test for every existing user.

### The 10-minute version

**Layer 1 — CLI** (`src/cli.ts`, `src/commands/*`):
- `knit setup` (one-time, edits `~/.claude.json` to wire the MCP server)
- `knit status` (dashboard)
- `knit refresh` (rebuild knowledge brain)
- `knit install-agents` (VoltAgent subagents)
- `knit export` (Obsidian)

**Layer 2 — MCP server** (`src/mcp/*`):
- `server.ts` — entry point. Spawns the MCP SDK Server, registers tool definitions, attaches the stdio transport.
- `tools.ts` — registry of 43 tool definitions (JSON Schema in `inputSchema`).
- `handlers.ts` — implementations. Currently 2142 lines (open TODO M1 to split).
- `cache.ts` — process-level brain cache. Loads `~/.knit/projects/<hash>/` once per session.
- `sanitize.ts` — secret redaction before any user input lands on disk.

**Layer 3 — Engine** (`src/engine/*`):
- `knowledge.ts` — import graph + exports + test map. Built by `scanner.ts` walking the repo.
- `knowledgebase.ts` — learnings + access metrics + false positives. Persisted to `knowledgebase.json`.
- `sessions.ts` — append-only `sessions.jsonl`, branch-diversified BM25 search.
- `retrieval/bm25.ts` + `retrieval/rrf.ts` + `retrieval/graph-traversal.ts` — vectorless RAG layer.
- `protocol-guard.ts` — runtime enforcement via PreToolUse hooks.
- `teams.ts` + `worktrees.ts` — parallel team execution.

**Layer 4 — Generators** (`src/generators/*`):
- `claude-md.ts` — emits the marker-wrapped block into the project's `CLAUDE.md`.
- `settings.ts` — emits the hook config into `.claude/settings.local.json`.
- `workflow-protocol.ts` — phase-by-phase protocol fetched on demand by `knit_get_workflow`.

### The architectural decisions worth defending

1. **Vectorless retrieval (BM25 + RRF) instead of embeddings.** *Why:* zero dependencies, fully deterministic, runs in-process. Embeddings would have meant a vector DB dependency or a `@xenova/transformers` runtime, both ~10-100MB. The trade-off is recall on semantic-but-not-lexical queries — solved with the graph-traversal retriever fused via RRF.
2. **Centralized storage at `~/.knit/projects/<hash>/`.** *Why:* the project tree stays clean; teams can `git rm .claude/` without losing memory; you can `KNIT_HOME=…` for sandboxes. Trade-off: legacy `.claude/` users needed a migration path (handled by `migrateLegacyData`).
3. **MCP tools over a custom CLI surface.** *Why:* MCP is the protocol every coding agent already speaks. Knit gets distribution to Claude Code, Cursor, Codex without per-client code.
4. **Hooks as enforcement, not as gates.** *Why:* a hook that blocks edits when the agent skipped a step is a bad UX — agents hit the wall and don't know why. Hooks default to `warn` and only escalate to `block` on explicit opt-in. Strictness is a per-project config.
5. **Lazy workflow loading via `knit_get_workflow(phase)`.** *Why:* most sessions don't need the full protocol depth. Pulling it on demand cut CLAUDE.md from 16KB → 2KB per session.

---

## 4. MCP deep-dive — the protocol, the patterns, the pitfalls

### What MCP actually is

The Model Context Protocol is a JSON-RPC 2.0 protocol that lets an AI client (Claude Code, Cursor, etc.) talk to a server providing **tools**, **resources**, and **prompts**. Specification: https://modelcontextprotocol.io/specification

The transport is usually `stdio` (the server is spawned as a subprocess; messages flow over stdin/stdout) or Streamable HTTP. Knit uses stdio.

### The message lifecycle

```
client (Claude Code)                server (Knit)
        |                                 |
        |  initialize { caps, version }   |
        |-------------------------------->|
        |                                 |
        |  initialize result { caps }     |
        |<--------------------------------|
        |                                 |
        |  notifications/initialized      |
        |-------------------------------->|
        |                                 |
        |  tools/list                     |
        |-------------------------------->|
        |                                 |
        |  result: [...43 tools...]       |
        |<--------------------------------|
        |                                 |
        |  tools/call { name, args }      |
        |-------------------------------->|
        |                                 |
        |  result: { content: [...] }     |
        |<--------------------------------|
```

Every `tools/call` returns `{ content: [{ type: 'text', text: '...' }] }`. Knit's tool handlers return JSON strings; the SDK wraps them.

### The patterns that matter

1. **Server-side `instructions` field** (Knit uses this in `mcp/instructions.ts`). Set at server init; injected into the client's system prompt before tool descriptions. This is how Knit ships its citation rule and protocol overview to every connected client.

2. **`notifications/tools/list_changed`** — emitted by the server when the available tool set changes. Knit emits this when `knit_enable_feature("teams")` flips a Tier-2 feature on. Modern clients re-fetch `tools/list` without restarting.

3. **Tool input schemas** are JSON Schema (draft 2020-12). Get this right and the client UI knows what to render. Get it wrong (Knit's current `Record<string, string>`) and every agent has to parse strings.

4. **stdio framing** — messages are newline-delimited JSON. Write your own messages with a trailing `\n`. Reading from stdin: buffer until `\n`, parse, dispatch.

### The pitfalls

- **stdout is a sacred channel.** Anything you `console.log` becomes a malformed MCP message. Log to `stderr` only. (Knit enforces this — every diagnostic uses `process.stderr.write`.)
- **Tool calls are blocking from the client's POV.** A slow tool blocks the agent. Long-running operations need to be async with polling tools (see Knit's TODO H3 — current `handleInstallAgent` is fire-and-forget, which is the wrong end of this trade-off).
- **Errors must round-trip.** A thrown handler should surface as a structured `{ error: ... }` payload, not crash the server. `server.ts:70-91` is Knit's safety boundary.
- **Schema enums are advisory only on most clients.** Validate inputs in the handler regardless of what `inputSchema.enum` says.

---

## 5. System design fundamentals you actually need

FDE interviews focus on **practical** distributed systems, not academic ones. The hits:

### The eight things to internalize

1. **Replication strategies.** Single-leader, multi-leader, leaderless. Trade-offs: consistency vs. write availability vs. read scalability. *Read DDIA ch. 5.*
2. **Partitioning.** Range-based vs. hash-based. Rebalancing strategies (consistent hashing, fixed partitions). *DDIA ch. 6.*
3. **Consistency models.** Strong, eventual, causal, read-your-writes. Why each matters in practice. *DDIA ch. 5 + 9.*
4. **Caching layers.** Cache-aside vs. write-through vs. write-behind. Cache invalidation strategies (TTL, explicit, event-driven).
5. **Message queues.** When you need them, when you don't. Backpressure handling. Idempotency on retry.
6. **Rate limiting.** Token bucket vs. leaky bucket vs. sliding window. Per-user vs. global limits.
7. **Schema evolution.** Backward compat, forward compat. Why protocol buffers and Avro exist. JSON Schema migrations.
8. **Observability triad.** Logs, metrics, traces. What goes in each.

### Knit-flavored system design exercises

**Exercise 1: Scale Knit to 10,000 users**
- Current: one MCP process per Claude Code session, local files.
- Question: how would you support cross-machine sync (so a user's learnings on laptop A appear on laptop B)?
- Answer threads to explore: CRDTs for learnings (no central server needed), or eventual-consistency sync to S3, or full server backend with auth.

**Exercise 2: Multi-tenant Knit-Agents**
- Production agents at a customer call into a shared Knit-Agents service.
- Question: how do you partition memory? How do you prevent customer A's learnings from leaking to customer B?
- Answer threads: project hash → tenant hash; per-tenant encryption keys; row-level security if SQL; namespace separation in object storage.

**Exercise 3: Cost-optimized agent retry**
- An agent fails a task at turn 47. You want to retry without re-running turns 1-46.
- Question: how do you checkpoint agent state? What's the on-disk format?
- Answer threads: append-only event log (like Knit's `sessions.jsonl`), Merkle hashing for compaction, snapshots every N turns.

### Designing the FDE-flavored system

For a Palantir-style interview, the system to design is usually one of:
- "A data ingestion pipeline that handles 10TB/day of customer logs."
- "A real-time alerting system that fires within 5s of an anomaly."
- "A multi-tenant agent platform that runs untrusted user code."

The pattern they want to see:
1. Clarify constraints (read-heavy or write-heavy? p99 latency target? consistency requirements?).
2. Estimate scale (rough numbers — 10TB/day = ~125 MB/s sustained).
3. Sketch the data flow first, components second.
4. Identify the bottleneck (usually disk I/O or network).
5. Pick the storage layer based on access pattern, *then* the service layer.
6. Explicitly call out failure modes (what if a node dies mid-write?).

---

## 6. AI/ML curriculum — from the start, deeply

You said *"touching all the AI and ML things deeply from start properly."* Here's the actual curriculum that gets you from where-you-are to FDE-ready-on-AI in ~10 weeks.

### Phase 1: Foundations (weeks 1-3, ~10 hrs/week)

**Math you can't skip:**
- Linear algebra: vectors, matrices, dot products, matrix multiplication, eigenvalues. (3Blue1Brown's *Essence of Linear Algebra* — 14 videos, ~3 hrs total. Watch all of them.)
- Calculus: gradients, partial derivatives, chain rule. (3Blue1Brown's *Essence of Calculus*.)
- Probability: Bayes' theorem, expected value, variance, distributions (Gaussian, Bernoulli, Multinomial).

**Code you must write yourself (no copy-paste):**
- A linear regression from scratch in NumPy. Gradient descent, no scikit-learn.
- A logistic regression from scratch.
- A 2-layer neural net from scratch. Train it on XOR.

**Concept anchors:**
- What is a loss function? (A function that gets smaller when your model is more right.)
- What is gradient descent? (Walk downhill on the loss landscape.)
- What is overfitting? (Memorizing training data instead of learning the pattern.)

### Phase 2: Deep learning (weeks 4-6, ~12 hrs/week)

**Watch + implement:**
- Karpathy's *makemore* series (5 videos). Implement each one yourself.
- Karpathy's *Let's build GPT from scratch* (~2 hr).

**Concepts:**
- Attention mechanism — why it works, what self-attention computes.
- Transformer architecture — encoder, decoder, multi-head attention, positional encoding.
- Tokenization — BPE, sentencepiece. Why "token" is not "word."
- Layer normalization vs. batch normalization.
- Residual connections — why they let you stack 96 layers.

**Code to write:**
- Implement nano-GPT yourself (Karpathy's repo as reference, but type it).
- Implement BM25 from scratch in Python. Compare to your `bm25.ts`.
- Implement a tiny RAG pipeline: chunk a document, embed (use OpenAI or sentence-transformers), retrieve, generate.

### Phase 3: LLM systems (weeks 7-10, ~15 hrs/week)

**Concepts:**
- RAG patterns — naive, hybrid (BM25 + dense), graph-augmented, agentic.
- Context windows — KV cache, attention scaling, sliding window, RoPE.
- Fine-tuning — LoRA, QLoRA, when fine-tuning beats prompting, when it doesn't.
- Evaluation — perplexity, ROUGE, BLEU, human eval, LLM-as-judge.
- Inference optimization — quantization, KV cache reuse, speculative decoding.

**Papers to read (1 per week):**
1. *Attention Is All You Need* (Vaswani et al., 2017). Read 3 times.
2. *LoRA: Low-Rank Adaptation of Large Language Models* (Hu et al., 2021).
3. *RAG: Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks* (Lewis et al., 2020).
4. *Toolformer* / *Gorilla* (one paper on tool use).
5. *Constitutional AI* (Anthropic, 2022).

**Hands-on:**
- Build a tool-using agent from scratch using the Anthropic SDK + MCP. (You've kind of done this — Knit is the substrate. Now build the client.)
- Run a context-drift experiment on your agent. Plot drift score over turns. **This becomes your blog post.**

### Phase 4 (optional, for Palantir specifically): Foundry/Ontology concepts

Palantir's product is Foundry / Ontology / AIP. They will not ask you to know it deeply, but knowing the vocabulary helps:
- **Ontology** — typed entities with relationships. Think TypeScript types + a database.
- **Pipelines** — data transformations expressed as DAGs.
- **Workshop** — the no-code application layer.
- **AIP** — Palantir's agent platform.

Watch *one* talk by Palantir's CTO on AIP. Don't try to learn Foundry — they'll teach you. Just don't sound surprised by the words.

---

## 7. Interview Q&A bank with real answers

### Behavioral

**Q1. "Tell me about a project you're proud of."**

Bad answer: *"I built a chatbot using React and OpenAI's API."*

Good answer: *"I built Knit — an MCP server that gives Claude Code persistent memory across sessions. The interesting part isn't the feature list; it's the design problem. Every coding agent re-investigates the same bugs because nothing persists. I built a 4-tier task classifier and a vectorless BM25+RRF retrieval layer so the agent finds prior learnings before re-investigating. It's on npm as knit-mcp, 43 MCP tools, 506 tests. The hardest part was a v0.3 migration where I moved storage from in-tree `.claude/` to centralized `~/.knit/`. I had to design a migration that ran silently on every existing user's first upgrade — they didn't ask for it, so I couldn't ask for input, and if it broke I'd silently delete their accumulated learnings. I wrote it idempotent with a breadcrumb file. Six months later it's still running cleanly."*

**Q2. "Tell me about a time you were wrong."**

Good answer: *"v0.1 of Knit stored learnings in the project's `.claude/` directory. I thought this was right — keep data near the code. Three weeks in, users started telling me they were git-committing the directory and leaking learnings between team members who shouldn't see them. I'd optimized for one mental model and missed another. The v0.3 redesign moved everything to `~/.knit/` with a sha256 hash of the repo root as the directory key. Lesson: 'where should this data live' is not just an engineering question; it's a privacy question. I run that check on every storage decision now."*

**Q3. "How do you decide what to build next?"**

Good answer: *"Three signals, in priority order. (1) A real user blocked on something — that always wins. (2) An audit finding I can articulate as a customer story ('two concurrent Claude sessions on the same project silently lose learnings' is a customer story, not a tech-debt item). (3) An interview I'm doing where I notice the gap. I never build from a hypothetical roadmap. Knit's v0.7 → v0.9 was driven entirely by drift-prevention requests from one founder who was deploying Claude on a real codebase."*

### Technical

**Q4. "Walk me through what happens when an agent calls `knit_search_learnings`."**

Good answer (the journey of one request):
> Client sends a `tools/call` JSON-RPC message over stdin. `server.ts` routes it to the SDK's `CallToolRequestSchema` handler. The handler dispatches to `handleToolCall(name, args, brain)` in `tools.ts`. The brain cache is loaded once per session — it's a single in-memory object holding the knowledge graph + KB + config. The search handler in `handlers.ts` runs BM25 over `kb.entries`, RRF-fuses with graph-traversal-boosted candidates if `files=` is passed, and returns the top-N. Total latency: ~5ms for a 200-entry KB. Returns as `{ content: [{ type: 'text', text: JSON.stringify(...) }] }`. Total round-trip from the agent's perspective: ~10ms.

**Q5. "How would you scale this to 10,000 concurrent users?"**

Good answer:
> Today each Knit instance is per-user, per-process — there is no shared state. So horizontal scale is trivial up to "every user runs their own MCP process locally." The interesting question is when users *want* shared state (team-wide learnings). That changes the answer: I'd introduce a sync layer. Per-user data stays local; a daemon batch-uploads anonymized learnings to a central store every 5 minutes. The store is keyed by team ID + project hash + learning hash so dedup is free. For 10k users that's ~100 req/sec at the store — fits on a single Postgres instance with a careful index. The harder problem is auth: who can see whose learnings? I'd start with team-scoped (one tenant ID) and add finer-grained permissions when a customer asks.

**Q6. "Your atomic write uses temp+rename. Why is that atomic? When does it break?"**

Good answer:
> POSIX `rename(2)` is atomic when source and target are on the same filesystem — the directory entry update is a single inode operation. So a reader either sees the old inode or the new one, never a half-written file. It breaks in three cases: (1) cross-filesystem rename — `rename` returns EXDEV, you have to fall back to copy+unlink which is *not* atomic. (2) Windows pre-Node-18 — older Node versions on Windows used MoveFileEx without the replace flag, which fails if target exists. Node 18+ fixed this. (3) Crash *between* the write and the rename — the temp file is left on disk. Knit's `saveEnabledFeatures` handles this with `unlinkSync` in the catch block. Crash *after* the rename, fsync hasn't completed, power loss — you can lose a write. The mitigation is `fsync` before rename, which I'm not doing today and probably should add for the knowledge brain.

**Q7. "Design a context-drift detector."**

Walk through it as if at a whiteboard:
1. *Signals.* What does drift look like? Agent repeating earlier statements verbatim. Confidence drops. Tool calls becoming syntactically invalid. User correcting the agent more than once in 3 turns.
2. *Per-turn measurement.* For each turn, compute: (a) similarity to last 5 turns (drift sign if high), (b) token entropy (drift sign if low), (c) tool-call validity rate.
3. *Window aggregation.* Sliding window of 10 turns. Drift score = weighted sum of signals.
4. *Threshold + action.* When drift score exceeds T, compress the context (summarize turns 1-K, retain K-N), or escalate to human handoff.
5. *Evaluation.* Mark drift events with a "ground truth" label — did the user have to correct? Did the agent fail to complete the task? Train T against this.

**Q8. "What's the most over-engineered part of Knit? What would you remove?"**

Good answer (this shows judgment):
> The team-worktree system. It's three engine modules and nine MCP tools, and probably 5% of users have used it. I added it during the v0.4 dogfooding push because I needed it myself for parallel domain-team writes. But it's a real complexity tax — onboarding now has to explain a feature most users don't need. If I started over, I'd gate it behind a CLI flag and not surface the tools until someone calls `knit_enable_feature("teams")`. v0.7 did exactly this — Tier-2 features auto-activate only when the project shape matches. So I didn't *remove* it, but I made it pay rent.

### The killer "Why FDE?" question

**Q9. "Why FDE specifically, not regular engineering?"**

Good answer:
> Because I learn fastest when I can see the user. Every Knit feature came from watching a real session that failed — never from a roadmap meeting. The FDE role compresses that loop: customer in front of you, problem on the whiteboard, fix in production by Friday. The trade-off is breadth over depth — you ship a less-perfect thing because the customer needs it now. That trade-off matches how I already work. Regular engineering optimizes for clean abstractions; FDE optimizes for *correct* abstractions for *this* customer's *this* problem. I'd rather be wrong faster.

---

## 8. Practice problems, ranked

### Daily — 30 min cap

1. **Leetcode-medium.** One per day. Track which patterns you miss (sliding window, two-pointer, monotonic stack, union-find).
2. **One paragraph technical writing.** Pick a Knit decision, write a 100-word justification. Build the "terse and clear" muscle.

### Weekly — 2 hours

1. **Read a real codebase for 1 hour.** Don't try to understand everything. Pick one file, trace what calls it. (Recommended: `modelcontextprotocol/typescript-sdk`, `mem0ai/mem0`, `langchain-ai/langgraph`.)
2. **Mock interview.** Pramp, interviewing.io, or a friend.

### Project-scale — once

1. **The mini-project below.** [§9](#9-the-mini-project-knit-agents-drift-detector)

### Knit-specific drills

Pick a Knit file. Cover the rest of the codebase. Now answer:
- What does this file export?
- Who calls each export? (Use Knit itself: `knit_query_imports`.)
- What's the most fragile assumption it makes?

Do this for `src/engine/knowledgebase.ts`, `src/mcp/handlers.ts`, `src/mcp/cache.ts`, `src/engine/scanner.ts`. After four files you'll know your own codebase the way an interviewer asks you to.

---

## 9. The mini-project: Knit-Agents drift detector

**What you're building:** An open-source SDK that wraps any production AI agent (Claude, GPT, Gemini) and detects context drift in real time, with the option to auto-recover via context compression or human handoff. **Sold as ops-cost savings — every drift event prevented is wasted tokens saved.**

### Why this project

1. It's the natural extension of Knit (memory + workflow → drift prevention).
2. It targets the **white-space gap** from the market research: nobody prevents drift, everyone observes it.
3. It's demoable in 30 seconds, which is what interviews need.
4. It compounds with Knit's existing user base (every Knit user is a potential Knit-Agents user).

### MVP scope (Weeks 3-4, 40 hrs total)

**Public API:**

```typescript
import { wrapAgent } from 'knit-agents';

const agent = wrapAgent(myExistingAgent, {
  onDrift: (signal) => {
    console.log(`Drift detected: ${signal.reason}, score ${signal.score}`);
  },
  autoCompress: true, // when drift > threshold, compress turns 1-N
  threshold: 0.7,
});

// User code is unchanged
const result = await agent.complete({ messages });
```

**Internal architecture:**

```
agent.complete() called
   │
   ▼
[turn recorder]  — append every turn to a per-session ring buffer
   │
   ▼
[drift detector] — compute drift score every turn
   │
   ▼
[action router]  — below threshold: pass through; above: compress / handoff
   │
   ▼
[telemetry]      — log to local jsonl; opt-in cloud sync later
```

**Drift signals (start with these):**

| Signal | How to compute | Weight |
|---|---|---|
| **Self-similarity** | Jaccard overlap between current turn and last 5 turns | 0.4 |
| **Confidence proxy** | If model exposes logprobs, mean logprob of generated tokens; else use response length variance | 0.2 |
| **Tool-call validity** | % of tool calls that parse + dispatch successfully in last 10 turns | 0.3 |
| **User correction rate** | Count of "no", "wrong", "that's not what I asked" patterns in last 5 user turns | 0.1 |

Composite score = weighted sum, clamped to [0, 1]. Threshold defaults to 0.7.

### The 30-second demo for interviews

1. *"Here's an off-the-shelf customer support agent built with Claude. Watch what happens after 50 turns of a confusing conversation."*
2. Show the agent repeating itself, losing the user's name, recommending the wrong product.
3. *"Same agent, wrapped with Knit-Agents."* Drift score climbs at turn 38, hits threshold at 47, auto-compresses turns 1-30 into a summary. Agent recovers.
4. *"Token cost saved on this single conversation: $0.40. At 10,000 conversations/day for a mid-size SaaS, that's $40k/year."*

### Ship dates

- **Week 3:** turn recorder + drift detector + jsonl telemetry. Run it on a recorded conversation. Internal demo only.
- **Week 4:** auto-compression + the SDK shape above. Publish to npm as `knit-agents`. Tweet the demo Loom.

### What to do during the interview

Open your laptop. Run the demo live. *Show the drift score graph.* Most candidates talk; you show. That's the entire pitch.

---

## 10. Daily practice routine

| Block | Time | What |
|---|---|---|
| **Morning, 60 min** | 7:00–8:00 | 1 Leetcode-medium + 15 min reading a real codebase |
| **Class** | — | Pay attention. Sleep enough. |
| **Afternoon, 90 min** | varies | Knit code work (1 audit fix, or 1 PR, or 1 paragraph of docs) |
| **Evening, 90 min** | 19:00–20:30 | AI/ML — Karpathy + paper + implement |
| **Wind-down, 15 min** | before sleep | Tweet ONE thing — a finding, a bug, a design note. Build the audience. |

**Weekly:**
- Saturday: 3-hour deep block — finish whatever you started during the week. Mock interview.
- Sunday: review week. What shipped? What's blocked? Apply to 5 more roles.

**Don't:**
- Pull all-nighters. Your sleep is the difference between solving the problem at hour 3 and missing it at hour 6.
- Watch tutorials passively. If you're not typing while watching, you're not learning.
- Try to be the smartest. Try to be the most consistent. Consistent ships products. Smart writes blog posts.

---

## 11. Reading list — what's actually worth your time

### Books — pick exactly two, finish them

1. *Designing Data-Intensive Applications* (Kleppmann). Skip ch. 7-9 on first pass; come back later.
2. *The Mythical Man-Month* (Brooks). Read ch. 1-3 + "No Silver Bullet" essay. Old, but the management-of-software-engineering ideas haven't been improved on.

### Long-form pieces — read all of these

- *Worse Is Better* by Richard Gabriel — the New Jersey / MIT contrast.
- *Choose Boring Technology* by Dan McKinley — the "innovation tokens" framing.
- *The Hundred-Year-Old API Question* (Hyrum's law) — *"with a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody."*
- Karpathy's *Software 2.0* essay.
- Patrick Collison's interview questions list.

### Watch

- Karpathy's *Let's build GPT from scratch* (everyone says this; everyone is right).
- Bret Victor's *Inventing on Principle* (47 min, will change how you think about tools).
- Any talk by Bryan Cantrill on Twitch streaming his work. (You're learning what senior eng thinking sounds like.)

### Don't bother

- Generic "system design interview" books past chapter 4. Past that point they teach the same five patterns 100 different ways.
- "Cracking the Coding Interview" — useful only for the leetcode warm-up. Skip the rest.
- AI-hype Twitter. One tweet a day from Karpathy / Antirez / Carmack is your full diet.

---

## Closing — the actual thing that wins

Three months from now, the candidate who beats you to the offer is the one who:

1. **Shipped more in public.** Five small Knit releases beat one perfect one.
2. **Talked to more users.** Five 20-minute conversations beat fifty hours of polishing.
3. **Wrote fewer words and shipped more diffs.** A 100-line PR with 2 sentences of context beats a 2000-word design doc with no code.
4. **Showed up consistently.** A 60-min daily block for 90 days produces more than a 6-hour weekend binge once a month.

You're 18, building something real in a market where most of the incumbents are mid-30s VC-backed teams. Your unfair advantage is *time* + *attention* + *the willingness to be terse and direct.* Don't burn the first two on perfectionism. Don't burn the third on Twitter takes.

Ship. Talk to users. Apply to 20 places. Repeat for 12 weeks. Pick the best offer in August. Go.
