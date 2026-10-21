# Pickem

A realtime pick'em app. People create polls, share a link, and friends vote.
Results update live while voting is open, and a poll closes on its own schedule
or early when the owner decides.

## Stack

- **Next.js 16** (App Router, Turbopack) with **React 19** and **Tailwind CSS v4**
- **PostgreSQL** on **Neon** via **Drizzle ORM**
- **Better Auth** for sessions (Google OAuth, plus guest voting with no account)
- **Upstash Redis** for rate limiting and the results cache
- **Vitest** for unit and integration tests, **Playwright** for end-to-end tests
- **k6** for load scenarios

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the values
npm run dev
```

Open <http://localhost:3000>.

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Runtime database URL. Neon’s **pooled** URL. |
| `DATABASE_URL_UNPOOLED` | Neon’s **direct** URL. Required for migrations. |
| `DATABASE_POOL_MAX` | Optional. Connections per instance. Defaults to 5. |
| `BETTER_AUTH_SECRET` | Better Auth signing secret. |
| `BETTER_AUTH_URL` | Public origin of the deployment. |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Optional. Origins allowed to make state-changing auth requests. Defaults to `BETTER_AUTH_URL`. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google OAuth credentials. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Rate limiting and results cache. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob, for option images. |
| `DATABASE_URL_TEST` | Disposable branch URL used by the test suites. |
| `ALLOW_TEST_DB_MUTATION` | Must be `1` to let tests write to that branch. |
| `PRODUCTION_DATABASE_HOST` | Optional. Production hostname only, used by the test guard. |
| `ENABLE_LOAD_TEST_ROUTES` | Enables the load-test route. Preview only. |
| `LOAD_TEST_SECRET` | Shared secret for the load-test route. Preview only. |
| `LOAD_TEST_ALLOW_LOCALHOST` | Optional. Allows a localhost k6 target. |

### Google sign-in

`BETTER_AUTH_URL` is the public origin of the deployment: set it to the
production URL in Production, and to the preview URL in Preview.
`BETTER_AUTH_TRUSTED_ORIGINS` lists the origins allowed to make state-changing
auth requests, and defaults to `BETTER_AUTH_URL`.

Set `BETTER_AUTH_TRUSTED_ORIGINS` to the **production URL only**. Google
sign-in then works on the production domain and is refused on preview
deployments, instead of failing later at the OAuth redirect because the
production redirect URI is not registered for a preview host. Preview
deployments should still register their own origin in the Google console
before this restriction is lifted.

### Database

```bash
npx drizzle-kit migrate        # applies drizzle/*.sql
npx drizzle-kit generate       # creates a migration after a schema change
```

Migrations must run against a **direct** connection, not the pooler.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `npm run start` | Production build and server. |
| `npm run lint` | ESLint. |
| `npm run typecheck` | Generates route types, then runs `tsc --noEmit`. |
| `npm test` | Unit and integration tests. |
| `npm run test:integration` | Integration tests only. |
| `npm run test:e2e` | Playwright end-to-end tests. |

Integration and end-to-end tests need `DATABASE_URL_TEST` and
`ALLOW_TEST_DB_MUTATION=1`. They refuse to run when the target database is the
production database.

## How it works

A poll is an event with options, a voting window (`opens_at` / `closes_at`) and
a visibility: `unlisted`, `discoverable`, or `passcode`.

- **Voting** (`lib/events/voting.ts`) runs in one transaction. The ballot takes a
  shared lock on the poll row, so voters never block each other; the owner's
  "close early" action takes an exclusive lock, so a ballot either commits
  before the close or is rejected. A final database-clock check rolls back any
  ballot that would land after the closing time.
- **Results** (`lib/events/results.ts`, `lib/live/result-cache.ts`) are versioned
  by submitted ballot count, cached in Redis for a second while a poll is open
  and for a day once it is closed, and served publicly through
  `/api/events/[id]/results`. Passcode and draft polls stay private.
- **Live updates** (`lib/live/`) poll that endpoint every couple of seconds and
  animate the differences.

See [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md) for the design
decisions and the reasoning behind them.

## Load testing

Guarded k6 scenarios live in [`scripts/load`](scripts/load/README.md). They
only run against a Vercel preview backed by a disposable Neon branch, and the
write scenario needs a secret header. See that README before running them.

## Deployment

`vercel.json` pins the function region to `sin1` (Singapore), next to the Neon
compute in `ap-southeast-1`. Every ballot makes about eight database round
trips, so running the functions near the database is worth roughly 150ms per
request.

Preview deployments run migrations during the build, against the preview
branch. Production migrations stay manual. The build refuses to migrate when
the target is the production database, so enable Neon preview branching before
relying on it.

The load-test endpoint under `app/api/load` is excluded from the deployment by
`.vercelignore`, and it also refuses to run outside a preview. The test suites
refuse to run when the target database is the production database.
