# Bots app

## Scope

The standalone Vite entry for the public Character Creator, Fleet, and the Brain shell.
The static auth seam leaves sign-in disabled with a same-tab, expiring draft
handoff. Real Hire is disabled. The local preview can rehearse Hire with
synthetic team and offer responses. See [Hire checkout](HIRE.md).
Tower Passwords uses in-memory fixtures and a storage seam typed from the
generated SDK storage schemas.

## Start here

- `src/main.tsx` registers routes and renders the shell.
- `src/fleet-data.ts` defines the scoped, read-only Fleet ports over generated
  auth DTOs. `src/fleet.tsx` joins the fixture roster and optional computer
  details into one horizontal rail. The ordinary build leaves Fleet reads
  offline. The separately authorized local auth bridge owns real transport.
- The local fixture uses `/fleet?example=hire` for a confirmed sample selection,
  and `compute-outage`, `roster-outage`, `denied`, or `empty` for alternate
  states. A confirmed Hire uses its current-tab fixture receipt and exact
  team/agent route. Browser Back from a Hub restores rail position and the
  exact card focus from the originating history entry.
- `src/brain.tsx` mounts Overview, Activity, and Email. `src/brain-model.ts` owns the
  viewer/team/agent reader and source-safe journal projection. The local
  fixture adapter reuses Fleet identity and the exact accepted Hire receipt.
  Replace the reader at the composition boundary when the backend contract is
  available. Access uses an injected source.
- `src/return-intent.ts`, `src/draft.ts`, and `src/session.ts` own the handoff.
- `src/brain-access.tsx` renders inline Access with an injected source scoped to
  the viewer, team, and agent. `src/brain-access-fixture.ts` provides the local
  simulation for an explicitly selected viewer role.
- `src/passwords/` owns the Tower vault, local role and setup fixtures, and
  storage projections. The default build excludes this fixture route module.
- `src/billing/` owns the read-only Tower Billing route and its typed,
  team-scoped reader. The default reader is unavailable. The local fixture
  supplies the sample cycle and can exercise pending, denied, empty, and zero
  observations without contacting any service.
- `src/motion.css` owns the shell's motion and the fixed terrain scene from
  `src/assets/terrain.svg`. Animate only opacity and the transform family
  (`transform`, `translate`, `scale`), and give every new rule a
  `prefers-reduced-motion` final frame. Passwords and Billing get the faint
  terrain and no motion.
- `scripts/verify-bots-boundary.ts` and `scripts/botsBoundary.ts` enforce isolation.
  Keep imports inside this app or an explicitly allowed workspace package.

## Checks

Run these commands from the workspace root.

```sh
bun run --filter @macro-inc/bots check:boundary
bun run --filter @macro-inc/bots type-check
bun run --filter @macro-inc/bots lint
bun run --filter @macro-inc/bots test
bun run --filter @macro-inc/bots build
```

`bun run --filter @macro-inc/bots dev` serves the local fixtures on loopback
port 23030 with strict port checking. Check availability before starting it.
For a compiled fixture preview, run `bun run --filter @macro-inc/bots build:preview`
then `bun run --filter @macro-inc/bots preview`. That preview serves only
`dist-local`. Set `BOTS_PREVIEW_HOST` to a single exact hostname when an
authorized local reverse proxy needs a forwarded Host header.

The default build writes `dist` and excludes Fleet, Hire, Brain, Email,
Access, Passwords, and Billing fixture data. Keep
`dev.bots.macro.com` and `bots.macro.com` as planning targets until the relevant
auth, infrastructure, and release changes are approved.

## Brain Email

`src/brain-email-reader.ts` defines the scoped, read-only inbox and thread
port. `src/brain-email.tsx` supplies the Email view and mailbox identity
slot. Pass the same mailbox accessor to both after validating the current
viewer, team, and agent. In the local fixture preview, open Finch's Hub from
Fleet and select Email for the synthetic mailbox.

## Local signed review

Build the generated SDK JavaScript with `bun run --cwd packages/sdk build:js`.
With the isolated Macro Auth and Mailpit services already running on loopback,
run `bun run --filter @macro-inc/bots dev:auth` and open the printed
`127.0.0.1` origin. The local bridge uses the signed email-code callback
and current-team membership for the synthetic reviewer. The upstream access
token stays in server memory. The local server expires its opaque,
path-scoped session after ten minutes.

`session.getHireAccess()` reads current-team role, computer rollout, and the
gated teammate roster through generated Auth methods. The local result reports
roster denial separately from an empty authorized roster. It exposes no
payment terms and always disables purchasing. The static preview keeps its
existing fixtures. Sign-in accepts only exact destinations for Creator, Fleet,
Passwords, Billing, and same-tab Hire draft return.

For a remote review over an existing SSH connection, preserve both the
loopback address and the port in the local forward. For example, use
`ssh -N -L 127.0.0.1:PORT:127.0.0.1:PORT <devbox>` with the port printed by Vite.
Forward only the app. Auth and Mailpit remain on the devbox loopback.
