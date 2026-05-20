/**
 * Secret-pattern redaction for any string about to be persisted to disk
 * (learnings, handoffs, global pool). Users will paste tokens into bug
 * reports and learnings — this catches the common ones before they land
 * in plaintext on disk + get reindexed by reflection.
 *
 * Conservative on purpose: only patterns that are unambiguous tokens.
 * No generic long-base64 catch-all (too many false positives on hashes,
 * code samples, and legitimate IDs).
 */

interface SecretPattern {
  name: string;
  regex: RegExp;
}

const PATTERNS: SecretPattern[] = [
  { name: 'anthropic-key', regex: /sk-ant-[A-Za-z0-9\-_]{20,}/g },
  { name: 'openai-key', regex: /sk-[A-Za-z0-9]{32,}/g },
  { name: 'github-pat', regex: /ghp_[A-Za-z0-9]{20,}/g },
  { name: 'github-pat-fine', regex: /github_pat_[A-Za-z0-9_]{20,}/g },
  { name: 'github-oauth', regex: /gho_[A-Za-z0-9]{20,}/g },
  { name: 'gitlab-pat', regex: /glpat-[A-Za-z0-9\-_]{20,}/g },
  { name: 'aws-access-key-id', regex: /AKIA[A-Z0-9]{16}/g },
  { name: 'slack-token', regex: /xox[abopr]-[A-Za-z0-9-]{20,}/g },
  { name: 'npm-token', regex: /npm_[A-Za-z0-9]{36,}/g },
  { name: 'pem-private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g },
  // M4 additions — credential families the original set missed.
  { name: 'stripe-key', regex: /sk_(?:live|test)_[A-Za-z0-9]{24,}/g },
  { name: 'google-api-key', regex: /AIzaSy[A-Za-z0-9_-]{33}/g },
  // JWT: header.payload.signature, base64url segments. Reasonably tight to
  // avoid false-positives on arbitrary dotted strings.
  { name: 'jwt', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
];

export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const { name, regex } of PATTERNS) {
    out = out.replace(regex, `[REDACTED:${name}]`);
  }
  return out;
}

/**
 * Convenience: redact every string field on a params object in place.
 * Non-string values are left untouched.
 */
export function redactParams<T extends Record<string, unknown>>(params: T): T {
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (typeof v === 'string') {
      (params as Record<string, unknown>)[key] = redactSecrets(v);
    }
  }
  return params;
}
