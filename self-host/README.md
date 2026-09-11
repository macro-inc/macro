# Self-hosting Macro

Run Macro on your own machine, on your own domain, with `docker compose`.

Macro is AGPLv3, so self-hosting is a right, not a favour. This directory is
the supported way to exercise it: one box, one command, your DNS, your data.

> **Status: beta.** Every part of the product runs, and the data path is
> durable and backed up. But this is new, the hosted product is what gets the
> operational hours, and the object-storage layer is a known weak point (see
> [What to watch](#what-to-watch)). Read that section before you put a team's
> email on it.

---

## What you get

One origin, `https://your-domain`, serving the app and every API. Caddy
terminates TLS, gets certificates from Let's Encrypt automatically, and routes
by path to the services behind it. Nothing else publishes a port.

```
                     ┌──────────────────────────────────────────┐
  browser ──443──▶   │ caddy                                    │
                     │  /app         the frontend bundle        │
                     │  /auth /dss /email /cognition …          │
                     │  /sync /websocket  (websockets)          │
                     └───────────────┬──────────────────────────┘
                                     │  (private compose networks)
   ┌─────────────────────────────────┼─────────────────────────────────┐
   │ 15 Rust services   sync + lexical + ai-editing (workerd)          │
   ├───────────────────────────┬─────────────────────┬─────────────────┤
   │ postgres  redis  kafka    │ opensearch          │ fusionauth      │
   │ localstack (S3/SQS/DDB/KMS)                     │ + its postgres  │
   └───────────────────────────┴─────────────────────┴─────────────────┘
```

Three hostnames, all pointing at the same machine:

| Name | Purpose |
| --- | --- |
| `your-domain` | the app and all APIs |
| `s3.your-domain` | object storage. Presigned URLs are signed for this host, so it needs its own name |
| `auth.your-domain` | FusionAuth's own pages. Only Google/GitHub SSO sends a browser here |

## Requirements

- A Linux host with Docker and the Compose plugin. Nothing else — no Nix, no
  Rust, no Node.
- **16 GB RAM** realistically (OpenSearch and Kafka are the heavy tenants), 4+
  cores, 100 GB disk to start.
- Three DNS records pointing at the host, and ports 80 and 443 reachable from
  the internet. Let's Encrypt cannot issue certificates otherwise.
- An SMTP relay. Login codes are emailed; without mail nobody can sign in.

## Install

```bash
git clone https://github.com/macro-inc/macro.git
cd macro/self-host

./macroctl generate-secrets --domain macro.example.com --acme-email you@example.com \
                            --smtp-host smtp.example.com

# read .env, fill in the integrations you want, then:
./macroctl up
```

`generate-secrets` writes a `.env` with a fresh random value for every secret
and your domain substituted throughout. **Do not skip it and hand-edit
`.env.example`** — the local development stack ships fixed, publicly known
credentials, and a deployment that inherits them has no security at all.

`up` pulls images, renders the FusionAuth bootstrap, provisions storage and the
database, then starts everything. First run takes a few minutes; certificate
issuance adds a minute or so after that.

Sign in at `https://your-domain`. Any email address works — an account is
created on first login and the code arrives by email. There is no separate
signup step and no invite gate.

## Day-two operations

```bash
./macroctl status              # what is running, and its health
./macroctl logs email_service  # follow one service, or all of them
./macroctl backup              # database + object storage + config
./macroctl restore <dir>       # put it back
./macroctl upgrade v1.2.3      # backup, pull, migrate, restart
./macroctl down                # stop; data survives
./macroctl destroy             # stop and delete all data
```

Back up before every upgrade — `upgrade` does it for you, but an off-box copy
is yours to arrange. A backup contains `.env`, so it contains every secret:
store it like a password database.

Pin `MACRO_VERSION` in `.env` to a release tag for anything you care about.
`latest` follows `main`.

## Optional integrations

None of these block a working install. Each is inert until you supply real
credentials in `.env`, then `./macroctl up` again.

| Feature | What to set | Notes |
| --- | --- | --- |
| **AI** — agents, chat, doc cognition | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Nothing AI-shaped works without at least one |
| **Gmail** — inbox sync, SSO | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_KEY` | Your own Google OAuth app. Real Gmail at any scale also needs Google's restricted-scope security assessment |
| **GitHub** — SSO, PR linking | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | |
| **Calls** | `LIVEKIT_*` | Self-host LiveKit or use LiveKit Cloud |
| **Agents** | `./macroctl up --profile agents` | Read the warning below first |
| **Analytics** | `./macroctl up --profile analytics` | Only useful pointed at your own PostHog |

Billing is off. The signup path detects the placeholder Stripe key and stores a
local customer id instead of calling Stripe, so every account is simply active.

### Agents run containers on your host

The agent harness executes coding-agent sessions in sandboxes it creates on
**this host's Docker daemon**, which it reaches through a mounted
`/var/run/docker.sock`. That is root-equivalent access to the machine. It is
why the harness is behind a profile and off by default. Turn it on only if you
accept that, ideally on a host that does nothing else.

## What to watch

Told plainly, because you are the one carrying the pager.

**Object storage is LocalStack.** S3, SQS, DynamoDB and KMS are served by
LocalStack with persistence on and its state volume in the backup. It works,
and it is exactly what the dev stack has run for years — but LocalStack is
built as a development tool, not a storage system, and this is the piece to
replace first if you have managed equivalents. Every file users upload lives
here. Take the backups seriously.

Note especially: the KMS key encrypts users' stored Cursor API keys. Lose the
LocalStack volume without a backup and those rows survive in Postgres but can
never be decrypted again.

**Document sync state is a working set, not the record.** `sync-service` runs
the Cloudflare Worker under `workerd` via `wrangler dev`, with Durable Object
storage on a named volume. Document snapshots are published back to
document-storage-service, so the durable copy is in Postgres and S3 — but edits
not yet flushed live only in that volume. Don't delete it casually.

**No high availability.** One box, one of everything. Restarting the host means
downtime; losing it means restoring from backup.

**Some things only exist hosted.** The iOS app talks to Macro's cloud. Push
notifications need an AWS SNS account. Google's Gmail approval, and Apple's,
are Macro's, not yours.

**Two surfaces have no container at all**, here or in the local dev stack, so
they are absent rather than broken: the PDF service, and scheduled actions
(`agent-schedule`). Anything that depends on them will not work.

## How this stays in sync with the product

`docker-compose.yml`, `Caddyfile` and `.env.example` are checked in so you need
no toolchain to deploy. That means they can fall behind the code they were
derived from, so a check enforces it:

```bash
python3 scripts/check-drift.py
```

It reads the same Rust catalogs the dev stack is built from —
`inventory.rs` for services and their routes, `resources.rs` and
`macro_queues` for buckets, queues and tables — and fails if this directory has
drifted. CI runs it before publishing any image.

Service images are built from the same nix derivations the rest of the project
uses, with one deliberate exception: `authentication_service` comes from the
**deploy** build, not the local-stack one. The local-stack build carries
`return_passwordless_code` and drops the rate limit so a developer can complete
a login without opening a mailbox. Served publicly that is an authentication
bypass, so the publish workflow replaces the binary and then asserts it did.

## Layout

```
self-host/
├── macroctl              operator CLI — the only thing you run
├── docker-compose.yml    the stack (generated; checked by check-drift.py)
├── Caddyfile             TLS, routing, static frontend  (same)
├── .env.example          every setting, documented      (same)
├── kickstart/            FusionAuth bootstrap templates
├── init/                 provisioning image: migrations, storage, indices
├── images/               service + web image definitions
└── scripts/              drift check
```

## Getting help

Self-hosting questions belong in a GitHub issue on
[macro-inc/macro](https://github.com/macro-inc/macro). For commercial support,
managed hosting, or a licence other than the AGPL, Macro asks you to write to
`self-host@macro.com` and `licensing@macro.com`.
