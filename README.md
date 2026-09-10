# SyncPal

SyncPal is a public embedded Shopify app that sends fulfillment tracking information to PayPal. It processes Shopify webhooks asynchronously so PayPal API calls never delay webhook responses.

## Features

- Per-shop PayPal OAuth connection and disconnection
- Initial synchronization of eligible order history
- Automatic synchronization from `fulfillments/create` webhooks
- Asynchronous processing with up to three attempts per job
- Dashboard with connection status and synchronization counters
- Synchronization history with error details and manual retries
- One flat-rate Shopify plan with a free trial

## Stack

- Shopify CLI with React Router and TypeScript
- React, Shopify Polaris, and Shopify App Bridge
- PostgreSQL with Prisma ORM
- Redis with BullMQ and ioredis
- AES-256-CTR token encryption with `node:crypto`

## Local Setup

Install dependencies:

```bash
npm install
```

Create the local environment file and start PostgreSQL and Redis:

```bash
cp .env.example .env
docker compose up -d
npm run prisma -- migrate dev
```

Configure the PayPal credentials and token encryption key in `.env`. Shopify CLI supplies Shopify app variables while running the development server.

Start the app:

```bash
npm run dev
```

Shopify CLI starts both the web app and the PayPal synchronization worker. In a
deployed environment, run `npm run worker` as a separate long-running process.

## Validation

```bash
npm run lint
npm run typecheck
npm run build
```

## Security

- Never commit `.env` files, OAuth secrets, encryption keys, access tokens, or authorization headers.
- PayPal tokens must be encrypted before persistence and decrypted only in memory.
- Webhooks must be authenticated with Shopify's official utilities before their payloads are processed.
- Stored API responses must be sanitized and contain no credentials or authorization data.

## Scope

The MVP does not include localization, complex exports, or email alerts.
