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

  // ── M4: added patterns (Stripe live/test, Google API, JWT) ─────
  // Fixtures use string concatenation so GitHub's push-protection secret
  // scanner doesn't flag them as live Stripe keys (they aren't — the body
  // is ABCDEFG… placeholder). Runtime behavior is identical.
  const stripeLive = 'sk_' + 'live_' + 'ABCDEFGHIJ1234567890abcd';
  const stripeTest = 'sk_' + 'test_' + 'ABCDEFGHIJ1234567890abcd';

  it('redacts Stripe live keys (sk_live_…)', () => {
    const out = redactSecrets(`charged via ${stripeLive} ok`);
    expect(out).toContain('[REDACTED:stripe-key]');
    expect(out).not.toContain(stripeLive);
  });

  it('redacts Stripe test keys (sk_test_…)', () => {
    const out = redactSecrets(`test mode ${stripeTest} here`);
    expect(out).toContain('[REDACTED:stripe-key]');
  });

  it('redacts Google API keys (AIzaSy…)', () => {
    const out = redactSecrets('key=AIzaSyDABCDEFGHIJKLMNOPQRSTUVWXYZ1234567 ok');
    expect(out).toContain('[REDACTED:google-api-key]');
    expect(out).not.toContain('AIzaSyDABCDEFGHIJKLMNOPQRSTUVWXYZ1234567');
  });

  it('redacts JWTs (eyJ…header.payload.signature)', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const out = redactSecrets(`Authorization: Bearer ${jwt}`);
    expect(out).toContain('[REDACTED:jwt]');
    expect(out).not.toContain(jwt);
  });
});
