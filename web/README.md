# TrendCraft Web

Next.js application with React, Drizzle/PostgreSQL, Inngest background jobs,
and Remotion video rendering. Run the commands below from `web/`.

## Local Setup

Use Node.js 20.9 or newer and install the locked dependencies:

```sh
npm ci
```

Create a private `.env.local` from `.env.example`. Set `DATABASE_URL` to a
PostgreSQL database you control and generate a long random `AUTH_WORKER_TOKEN`.
The current database client requires PostgreSQL; old PGlite files are not used.
No credentials or workspace database are included in the repository.

For a new, empty development database only:

```sh
npm run db:push
```

Review SQL changes before applying them to an existing database. The additive
owner/auth upgrade is in `drizzle/brand-auth.sql`.

Start the app and background worker in separate terminals:

```sh
npm run dev -- -p 3001
npm run inngest:dev
```

Open http://localhost:3001/login. New accounts receive separate brand
workspaces. The worker helper defaults to port 3001 and authenticates its
callback with `AUTH_WORKER_TOKEN`; set `APP_URL` if the app uses another origin.

The existing `dev` command includes a local Windows antivirus certificate
path. On another machine, run `npx next dev -p 3001` instead; configure a trusted
local certificate through `NODE_EXTRA_CA_CERTS` only if your network needs it.

## Providers And Media

Start with `MOCK_MODE=true`. Mock clients read local files under `fixtures/`;
these captured responses and their media are intentionally excluded from Git.
Provision sanitized fixtures separately before using those workflows. Mock
mode is not a global billing or network safety boundary: some direct generation,
brand-analysis, and engagement routes use their own provider integration.
Do not configure paid credentials until you intend to exercise those routes.

Set only the providers needed for a workflow: Apify/YouTube for discovery,
Anthropic/OpenRouter for supported AI operations, Runway for direct product
video generation, HeyGen for avatar generation, and SwayBees for engagement.
See `.env.example` and `lib/clients/` for configuration.

Generated clips, persona anchor images and videos, rendered exports, user
uploads, and brand assets are not bundled. Provision licensed assets under
`public/persona-library/` and other expected media paths, or generate/upload
new assets through the app. The persona catalog references local asset names
in `lib/render/personaLibrary.ts`.

SwayBees runs separately; the local default is http://localhost:5100.
SwayBees test delivery creates actual test-mode tasks, not live payouts.
A local simulation is a separate option. Live Instagram connection/publishing
is not implemented; do not treat a test campaign as a published post.

## Brand Access

`/login` provides sign-in and registration. Opaque sessions are stored as
hashes, expire after seven days, and are revoked at logout.

For an existing GloVibe workspace only, run
`node scripts/setupBrandAuth.cjs <owner-email>` to apply the additive auth
migration and reserve its owner. The private one-time link is saved in ignored
`storage/auth/owner-setup.json`; the owner chooses their password in the browser.
The script does not reset an already-claimed account. Do not run this
workspace-specific bootstrap against an unrelated database.

Private creator-reference videos use expiring signed URLs. Production requires
HTTPS. Email verification, password-reset delivery, team invitations, and
per-brand billing are not implemented yet.

## Verification

The focused unit suite makes no paid generation calls:

```sh
node --test scripts/brandAuth.test.cjs scripts/engagementMedia.test.cjs scripts/brandFeed.test.cjs scripts/previewAgent.test.cjs scripts/missionControl.test.cjs
```

`node scripts/verifyBrandAuth.cjs` performs browser/database checks with
temporary accounts and cleans up its fixtures. It does not claim the owner's
setup link or launch creator tasks. Browser scripts currently reference a
local Playwright runtime/browser path; configure those for your machine first.
Other authenticated workflow checks need a signed-in browser context.

Existing TypeScript errors in legacy rendering, slot-value, and utility-script
code still need resolution before a production build. A successful unit test
run alone does not establish deployment readiness.
