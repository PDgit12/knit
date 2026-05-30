/**
 * v0.22 — MCP `prompts` capability. On hosts that surface MCP prompts (confirmed:
 * Copilot / VS Code), these appear as `/mcp.knit.*` slash commands — turning the
 * v0.21 README-paste onboarding into a native command and giving the agent a
 * one-call workflow primer. Pulled on demand (not resident in context), so they
 * add zero handshake token cost. Hosts without prompt support simply never call
 * prompts/list — the capability degrades gracefully.
 */

export interface KnitPromptDef {
  name: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
}

export interface KnitPromptMessage {
  role: 'user';
  content: { type: 'text'; text: string };
}

/** The prompt catalog returned by prompts/list. */
export const KNIT_PROMPTS: KnitPromptDef[] = [
  {
    name: 'knit_onboard',
    description: 'Onboard Knit to this project — describe what it is and how you want Knit to behave.',
    arguments: [],
  },
  {
    name: 'knit_workflow',
    description: 'Knit core-loop primer: how to drive memory + the tier-routed protocol this session.',
    arguments: [],
  },
];

/** Resolve one prompt by name (prompts/get), or null if unknown. */
export function getKnitPrompt(name: string): { description: string; messages: KnitPromptMessage[] } | null {
  if (name === 'knit_onboard') {
    return {
      description: KNIT_PROMPTS[0].description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Onboard Knit to this project. Ask me (or infer from the repo) two things: (1) what this project IS, and (2) what I am building / my current goal. Then call knit_onboard with project_description + intent, and — if I state preferences — strictness (off|warn|block), focus_domains, orchestration (auto|suggest|off), and token_mode (lean|standard). Confirm what was saved.',
          },
        },
      ],
    };
  }
  if (name === 'knit_workflow') {
    return {
      description: KNIT_PROMPTS[1].description,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              'Follow Knit\'s core loop for this task: call knit_load_session first, then knit_classify_task before any non-trivial edit and follow the tool_plan it returns. Verify codebase claims with knit_verify_claim before LEARN, and record a non-obvious insight with knit_record_learning when done.',
          },
        },
      ],
    };
  }
  return null;
}
