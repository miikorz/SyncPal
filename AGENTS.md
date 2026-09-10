# AGENTS.md

## Product

SyncPal is a public embedded Shopify app. It sends order tracking information to PayPal whenever Shopify emits a `fulfillments/create` webhook to help merchants release held funds.

## MVP Scope

- Per-shop PayPal OAuth connection and disconnection.
- Initial synchronization of eligible history after onboarding.
- Immediate fulfillment enqueueing and asynchronous processing.
- A maximum of three attempts per job.
- Dashboard with connection status and counters.
- History with error details and manual retry.
- One flat-rate plan with a free trial through the Shopify Billing API.
- When PayPal is disconnected, reject new jobs and remove that shop's queued jobs.

Do not implement localization, complex exports, email alerts, or other features outside the MVP.

## Required Stack

- Shopify CLI and the official React Router template with TypeScript. Shopify no longer offers a `remix` template; React Router is its official successor.
- Node.js, React, Shopify Polaris, and Shopify App Bridge.
- PostgreSQL and Prisma ORM.
- Redis, BullMQ, and ioredis.
- `node:crypto` with AES-256-CTR for PayPal tokens.

Do not replace these technologies without explicit approval.

## Target Architecture

- `app/routes/webhooks.*`: authenticate webhooks with Shopify's official utilities, validate required fields, and enqueue jobs. Respond as quickly as possible and never call PayPal during a webhook request.
- `server/jobs/paypalSync.*`: consume jobs, confirm that PayPal remains connected, decrypt tokens only in memory, call PayPal, and record every result.
- Cryptography utility: expose `encrypt` and `decrypt`, obtain a 32-byte key from environment variables, and use a random IV for every value.
- Prisma: preserve Shopify's `Session` model and add `ShopConfig` and `SyncLog`.
- UI routes: dashboard, onboarding, and history using Polaris components and generated-template patterns.

Adapt exact names and extensions to the scaffold conventions before creating files.

## Data and Security Rules

- Never log tokens, secrets, encryption keys, or authorization headers.
- Store PayPal tokens only in encrypted form.
- Associate every job and log with a shop; never rely on `orderId` alone.
- Make synchronization idempotent to tolerate duplicate webhooks and retries.
- Validate webhooks with official authentication before reading or processing payloads.
- Store only useful, sanitized information in `rawResponse`.
- Keep secrets exclusively in `.env` and document their names in `.env.example`.

## BullMQ

- The handler only validates, creates the pending record when needed, and enqueues.
- Configure queue retries with `attempts: 3` and explicit backoff.
- The worker updates `SyncLog` consistently on success and failure.
- Comments should explain only critical decisions: idempotency, retries, rate limits, and per-shop cleanup.
- PayPal disconnection must mark the shop as disconnected before removing its pending jobs. The worker rechecks connection status to cover races.

## Working Agreement

- Implement step by step and do not advance beyond confirmed stages when following the initial plan.
- Reuse APIs, helpers, and conventions from the official template.
- Keep changes small, modular, and focused on the MVP.
- Apply Prisma migrations and run relevant tests or type checks after each change.
- Do not modify the `Session` model without checking the installed Shopify version requirements.
- Do not commit or publish changes without an explicit request.
- Write all documentation, code comments, README content, agent instructions, and repository-facing text in English.

## Base Commands

Confirm the actual `package.json` scripts before use. Expected commands are:

```bash
npm install
npm run dev
npm run build
npx prisma migrate dev
```

Do not assume test, lint, or type-check commands exist until they have been confirmed in the generated project.
