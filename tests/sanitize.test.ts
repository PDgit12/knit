import { describe, it, expect } from 'vitest';
import { redactSecrets } from '../src/mcp/sanitize.js';

describe('redactSecrets', () => {
  it('returns input unchanged when no secrets present', () => {
    const s = 'A normal learning about scanner.ts and the importGraph traversal';
    expect(redactSecrets(s)).toBe(s);
  });

  it('redacts Anthropic keys', () => {
    const out = redactSecrets('my key is sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz123456');
    expect(out).toContain('[REDACTED:anthropic-key]');
    expect(out).not.toContain('sk-ant-api03');
  });

  it('redacts OpenAI keys', () => {
    const out = redactSecrets('token sk-AbCdEfGhIjKlMnOpQrStUvWxYz1234567890ABCD failed');
    expect(out).toContain('[REDACTED:openai-key]');
  });

  it('redacts GitHub personal access tokens', () => {
    const out = redactSecrets('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz123456');
    expect(out).toBe('[REDACTED:github-pat]');
  });

  it('redacts AWS access key IDs', () => {
    const out = redactSecrets('access: AKIAIOSFODNN7EXAMPLE end');
    expect(out).toContain('[REDACTED:aws-access-key-id]');
    expect(out).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  it('redacts PEM private key blocks', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nABCDEFGH\nIJKLMNOP\n-----END RSA PRIVATE KEY-----';
    const out = redactSecrets(`prefix ${pem} suffix`);
    expect(out).toContain('[REDACTED:pem-private-key]');
    expect(out).not.toContain('ABCDEFGH');
  });

  it('redacts multiple secrets in one input', () => {
    const out = redactSecrets('ghp_AbCdEfGhIjKlMnOpQrStUvWxYz123456 then AKIAIOSFODNN7EXAMPLE');
    expect(out).toContain('[REDACTED:github-pat]');
    expect(out).toContain('[REDACTED:aws-access-key-id]');
  });

  it('handles empty / null-ish input safely', () => {
    expect(redactSecrets('')).toBe('');
  });
});
