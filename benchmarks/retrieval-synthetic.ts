/**
 * v0.11.2 — Synthetic retrieval benchmark.
 *
 * 50 questions against a 50-paragraph synthetic spec doc.
 * Measures top-1 accuracy + recall@5 on Knit's BM25+RRF pipeline.
 *
 * Honest scope: this is a sanity-check harness, NOT a competitive
 * benchmark. It proves the retrieval primitives wire correctly and
 * catches regressions; it does NOT claim parity with mem0/Letta/
 * agentmemory until v0.13's LongMemEval-S run.
 *
 * Run: npx tsx benchmarks/retrieval-synthetic.ts
 */

import { buildSourceIndex, chunkRequirements, retrieveTopChunks } from '../src/engine/requirements.js';

interface QA {
  /** Question to retrieve against. */
  q: string;
  /** Chunk ID expected at top-1. The IDs are c1..cN in source order. */
  expected: string;
}

const CORPUS = [
  // 1
  'Payments must support idempotency keys to prevent duplicate charges from retried requests. Clients send Idempotency-Key header on POST /charges.',
  // 2
  'All webhook signatures are verified via HMAC SHA256 before processing. The signing secret rotates every 90 days; old secrets remain valid for 7 days.',
  // 3
  'Refund flow requires admin role authentication and an audit log entry. Refunds above $1000 require dual approval from two separate admin accounts.',
  // 4
  'PCI compliance mandates that card numbers never reach our servers. Use Stripe Elements to tokenize on the client; the server only sees opaque tokens.',
  // 5
  'Rate limiting: 100 requests per minute per merchant; exceeding returns 429 with a Retry-After header indicating seconds until the window resets.',
  // 6
  'OAuth tokens expire after 24 hours and require refresh. The refresh token has a 30-day lifetime and is single-use; consuming it returns a new pair.',
  // 7
  'SSO via SAML is supported for enterprise customers only. The IdP metadata XML must be uploaded via the admin console; auto-discovery is not supported.',
  // 8
  'Database migrations run via prisma migrate deploy in CI. The migration file naming convention is YYYYMMDD_descriptive_name; ordering is timestamp-based.',
  // 9
  'Email notifications are sent through SendGrid with templated content. Templates live in the templates/ directory; engagement metrics are tracked via webhooks.',
  // 10
  'Cron jobs are scheduled via the Vercel Cron API, not server-side schedulers. Each cron route is a serverless function that returns within 60 seconds.',
  // 11
  'Logs are forwarded to Datadog via the proxy at logs.example.com. PII fields (email, phone, name) are redacted via the structured-logger middleware.',
  // 12
  'Feature flags are managed via LaunchDarkly. New flags must include a kill-switch fallback; the SDK timeout is 200ms before falling back to the default.',
  // 13
  'Background jobs use BullMQ with Redis as the broker. Each job type has a dedicated queue; retries use exponential backoff capped at 5 attempts.',
  // 14
  'Image uploads are stored in S3 with server-side encryption (AES-256). Thumbnails are generated asynchronously via a Lambda triggered on PutObject.',
  // 15
  'GDPR delete-my-data requests are processed within 30 days. The request triggers a job that anonymizes user records and purges associated derived data.',
  // 16
  'API versioning is via the URL prefix (/v1, /v2). Deprecation policy: 6 months notice via the X-API-Deprecated header before a version is removed.',
  // 17
  'Search uses Algolia with synonyms configured per locale. The indexing batch size is 1000 records; index rebuilds run nightly during the maintenance window.',
  // 18
  'Subscriptions are managed in Stripe Billing. Webhook events for subscription.updated trigger a reconciliation job that syncs the billing status to our database.',
  // 19
  'Audit logs are immutable after write; corrections are applied via a compensating entry. Each log line includes actor, action, target, timestamp, and request ID.',
  // 20
  'Multi-region deployment runs in us-east-1 (primary) and eu-west-1 (secondary). Failover is DNS-based via Route 53 with a 60-second TTL on health checks.',
  // 21
  'Secrets are stored in AWS Secrets Manager with automatic rotation enabled. Application code never reads secrets from environment variables in production.',
  // 22
  'CSRF protection is enforced via SameSite=strict cookies plus double-submit token pattern. The token is rotated on each authentication state change.',
  // 23
  'CORS allows only registered origins; the list is managed via the admin console. Wildcard origins (*) are explicitly forbidden in the validation layer.',
  // 24
  'Pagination uses cursor-based encoding (opaque base64 strings). Offset pagination is not supported because skipping rows on large tables is inefficient.',
  // 25
  'WebSocket connections idle-disconnect after 5 minutes of inactivity. The client must send a ping frame every 4 minutes to keep the connection alive.',
  // 26
  'Database connection pooling uses pgbouncer with transaction-mode pooling. Maximum pool size is 50 per app instance; idle connections close after 60 seconds.',
  // 27
  'Image moderation uses AWS Rekognition with confidence threshold 0.85 for explicit content. Flagged images route to manual review queue, never auto-deleted.',
  // 28
  'Push notifications use Firebase Cloud Messaging for Android and APNs for iOS. The unified abstraction layer lives in lib/notifications.',
  // 29
  'Payment retries follow the network rules: card declined → no retry; insufficient funds → retry up to 4 times over 14 days with smart-retry logic.',
  // 30
  'Account deletion triggers a 30-day grace period during which the user can restore. After grace period, all PII is purged via the GDPR purge job.',
  // 31
  'JWT signing uses RS256 with keys rotated every 90 days. Tokens include a kid header so verifiers can pick the right key during rotation overlap.',
  // 32
  'Backup strategy: daily full snapshots retained 30 days; weekly retained 1 year; monthly retained 7 years for compliance. Restore tested quarterly.',
  // 33
  'Mobile API responses are gzip-compressed if Accept-Encoding includes gzip. Image responses use brotli for ~20% better compression than gzip.',
  // 34
  'Internationalization uses ICU MessageFormat strings. The translation files live in locales/<lang>.json; missing keys fall back to English at runtime.',
  // 35
  'Mobile app integrity is verified via Play Integrity (Android) and DeviceCheck (iOS) before sensitive operations. Failed checks downgrade the session.',
  // 36
  'Analytics events are batched client-side and flushed every 30 seconds or when the buffer hits 50 events. The endpoint is /v1/analytics/batch.',
  // 37
  'Two-factor authentication supports TOTP (Google Authenticator) and WebAuthn (security keys). SMS-based 2FA was deprecated in 2024.',
  // 38
  'The admin panel requires hardware-key MFA for any destructive action. Read-only admins do not require MFA but cannot trigger refunds or account deletions.',
  // 39
  'Rate-limit bypass for trusted partner IPs is configured via the partner-allowlist table. Bypass scope is per-endpoint; a partner can bypass /search but not /charges.',
  // 40
  'Search ranking weights: title 40%, description 30%, tags 20%, recency 10%. Boost rules for sponsored content add a configurable multiplier.',
  // 41
  'Bot detection uses Cloudflare Turnstile on login + signup. Triggered challenges log to the security audit trail; repeated failures escalate to a CAPTCHA.',
  // 42
  'Database queries use parameterized statements via Prisma; raw SQL is allowed only in migrations. SQL injection static analysis runs in CI on every PR.',
  // 43
  'Email deliverability monitoring tracks bounce rate per domain. If a domain hits 5% bounce rate, sends to that domain are throttled until the issue resolves.',
  // 44
  'Image carousel autoplays at 5-second intervals; pause on hover. Reduced-motion users get static display per the prefers-reduced-motion media query.',
  // 45
  'Latency SLOs: p50 < 200ms, p95 < 800ms, p99 < 2s. Alerts fire when any percentile exceeds the target for 5 minutes consecutively.',
  // 46
  'Server-sent events (SSE) power the activity feed. The connection is rebuilt with exponential backoff on disconnect; client maintains last-event-id for resumption.',
  // 47
  'CSP headers forbid inline scripts; all scripts are loaded with SRI hashes. Nonces are generated per-request for inline styles that cannot be externalized.',
  // 48
  'Health check endpoint /healthz returns 200 if database is reachable and Redis is reachable. Otherwise 503; the load balancer pulls failing instances out of rotation.',
  // 49
  'The export-my-data endpoint generates a tarball containing all user records as JSON. Generation is async; the user receives a one-time signed URL via email.',
  // 50
  'A/B test assignment is sticky per user_id and seeded by the test name. Assignment lookups are read from a cached config that refreshes every 60 seconds.',
];

const QUESTIONS: QA[] = [
  // Exact-phrase
  { q: 'idempotency keys', expected: 'c1' },
  { q: 'webhook signature verification HMAC', expected: 'c2' },
  { q: 'refund admin role audit log', expected: 'c3' },
  { q: 'PCI Stripe Elements tokenize', expected: 'c4' },
  { q: 'rate limiting 429 Retry-After', expected: 'c5' },
  { q: 'OAuth refresh token lifetime', expected: 'c6' },
  { q: 'SAML SSO enterprise IdP', expected: 'c7' },
  { q: 'database migrations prisma deploy', expected: 'c8' },
  { q: 'SendGrid email templates', expected: 'c9' },
  { q: 'Vercel Cron serverless schedule', expected: 'c10' },
  // Synonym / semantic
  { q: 'how do we prevent double-charging on retry', expected: 'c1' },
  { q: 'how are incoming hook events authenticated', expected: 'c2' },
  { q: 'who can issue refunds', expected: 'c3' },
  { q: 'how do we keep credit card data off our servers', expected: 'c4' },
  { q: 'how many calls can a merchant make per minute', expected: 'c5' },
  { q: 'session token expiry duration', expected: 'c6' },
  { q: 'single sign on for big customers', expected: 'c7' },
  { q: 'how do schema changes ship', expected: 'c8' },
  { q: 'transactional email vendor', expected: 'c9' },
  { q: 'scheduled job runner', expected: 'c10' },
  // Deeper corpus
  { q: 'log aggregation Datadog PII redaction', expected: 'c11' },
  { q: 'feature flag SDK LaunchDarkly', expected: 'c12' },
  { q: 'background queue Redis BullMQ', expected: 'c13' },
  { q: 'S3 image upload encryption', expected: 'c14' },
  { q: 'GDPR deletion timeline 30 days', expected: 'c15' },
  { q: 'API version URL prefix deprecation', expected: 'c16' },
  { q: 'Algolia search synonyms', expected: 'c17' },
  { q: 'Stripe subscription webhook reconciliation', expected: 'c18' },
  { q: 'audit log immutable compensating entry', expected: 'c19' },
  { q: 'Route 53 multi-region failover', expected: 'c20' },
  // Security-focused
  { q: 'AWS Secrets Manager rotation', expected: 'c21' },
  { q: 'CSRF SameSite cookie double-submit', expected: 'c22' },
  { q: 'CORS allowed origins wildcard forbidden', expected: 'c23' },
  { q: 'pagination cursor base64', expected: 'c24' },
  { q: 'WebSocket ping keepalive', expected: 'c25' },
  // Infra
  { q: 'pgbouncer transaction pooling pgpool', expected: 'c26' },
  { q: 'AWS Rekognition image moderation threshold', expected: 'c27' },
  { q: 'Firebase Cloud Messaging APNs', expected: 'c28' },
  { q: 'payment retry smart retry logic insufficient funds', expected: 'c29' },
  { q: 'account deletion grace period restoration', expected: 'c30' },
  // Advanced
  { q: 'JWT RS256 key rotation kid header', expected: 'c31' },
  { q: 'database backup retention compliance', expected: 'c32' },
  { q: 'gzip brotli compression mobile API', expected: 'c33' },
  { q: 'i18n ICU MessageFormat translation locales', expected: 'c34' },
  { q: 'Play Integrity DeviceCheck mobile app verification', expected: 'c35' },
  { q: 'analytics batch flush 30 seconds', expected: 'c36' },
  { q: 'TOTP WebAuthn 2FA SMS deprecated', expected: 'c37' },
  { q: 'admin panel hardware-key MFA destructive action', expected: 'c38' },
  { q: 'partner allowlist rate limit bypass', expected: 'c39' },
  { q: 'search ranking weights title description tags recency', expected: 'c40' },
];

async function main(): Promise<void> {
  const docText = CORPUS.join('\n\n');
  const chunks = chunkRequirements(docText, 50);
  if (chunks.length !== CORPUS.length) {
    console.error(`✗ Setup error: expected ${CORPUS.length} chunks, got ${chunks.length}. Adjust min_chars or paragraph length.`);
    process.exit(1);
  }
  const source = {
    sourceId: 'bench',
    sourcePath: '/synthetic.md',
    sourceBytes: docText.length,
    indexedAt: new Date().toISOString(),
    chunks,
  };
  const index = buildSourceIndex(source);

  let top1 = 0;
  let top5 = 0;
  const misses: Array<{ q: string; expected: string; got: string[] }> = [];

  for (const qa of QUESTIONS) {
    // Run through retrieveTopChunks for parity with handleGenerateTestCases.
    const hits = retrieveTopChunks([source], qa.q, 5);
    const gotIds = hits.map((h) => h.chunk.id);
    // BM25 search (low-level, no RRF):
    void index.search(qa.q, 5);

    if (gotIds[0] === qa.expected) top1++;
    if (gotIds.includes(qa.expected)) top5++;
    else misses.push({ q: qa.q, expected: qa.expected, got: gotIds });
  }

  const total = QUESTIONS.length;
  const top1Pct = (top1 / total) * 100;
  const top5Pct = (top5 / total) * 100;

  console.log('\nKnit retrieval synthetic benchmark (v0.11.2)');
  console.log('============================================');
  console.log(`Corpus:     ${CORPUS.length} paragraphs (~${Math.round(docText.length / 1024)}KB)`);
  console.log(`Questions:  ${total}`);
  console.log(`Pipeline:   BM25 + RRF (k=60) via retrieveTopChunks (same as handleGenerateTestCases)`);
  console.log();
  console.log(`Top-1 accuracy: ${top1}/${total} = ${top1Pct.toFixed(1)}%`);
  console.log(`Recall@5:       ${top5}/${total} = ${top5Pct.toFixed(1)}%`);
  console.log();

  if (misses.length > 0 && misses.length <= 5) {
    console.log('Misses (recall@5):');
    for (const m of misses) {
      console.log(`  q="${m.q}" expected=${m.expected} got=[${m.got.join(', ')}]`);
    }
    console.log();
  }

  // Honest framing.
  console.log('--');
  console.log('NOT a competitive benchmark. Synthetic 50-question corpus designed to');
  console.log('catch retrieval regressions, not to claim parity with mem0/agentmemory/Letta.');
  console.log('Real comparison requires LongMemEval-S (planned v0.13).');

  // Exit code: regression detection.
  // Drop below 85% top-1 = fail (catches BM25 tuning regressions, RRF k changes).
  if (top1Pct < 85) {
    console.error(`\n✗ REGRESSION: top-1 ${top1Pct.toFixed(1)}% < 85% threshold.`);
    process.exit(1);
  }
  console.log(`\n✓ Pass — top-1 ${top1Pct.toFixed(1)}% ≥ 85% threshold.`);
}

main().catch((err) => {
  console.error('Benchmark crashed:', err);
  process.exit(1);
});
