# View parity

Splitting a view into a desktop and a mobile view (FE-70) should change nothing
anyone sees. This harness checks that: it opens the same view in two builds of
the frontend that share one backend and compares them on a desktop, a phone and
a tablet.

It compares what a person can perceive and act on: the accessibility tree
(roles, names, text) and the position and size of every control and header
island. Class names and wrapper elements are left out, because a refactor may
change them without changing the page. Screenshots of both builds are saved
for the cases the comparison cannot judge.

It is a tool for the split, not a regression suite: it needs two running
frontends and a signed-in account, so CI does not run it. Delete it when the
"Not yet split" list in `rules/ast-grep/tsx-no-device-composition.yml` is empty.

## Run it

Both frontends must talk to the same backend so they show the same data. With a
local stack (`just run_local --instance <name>`, then
`just seed-scenario --instance <name> apply --file seed/scenarios/team-perms.json`):

1. The branch build is the stack's own frontend, at the proxy origin
   `just status_local --instance <name>` prints.
2. For the baseline, check out the merge-base in another worktree and start its
   dev server with the environment of the stack's own Vite process, on another
   port. It then proxies API requests to the same stack:

   ```sh
   git worktree add --detach ../view-parity-baseline "$(git merge-base origin/main HEAD)"
   cd ../view-parity-baseline && bun install --frozen-lockfile
   cd apps/web && bun run dev:prepare
   pid=$(pgrep -f vite | while read -r p; do
     tr '\0' '\n' </proc/$p/environ | grep -qx "PORT=<stack frontend port>" && echo "$p"
   done)
   env $(tr '\0' '\n' </proc/$pid/environ | grep -E '^(VITE_|MACRO_LOCAL_|NODE_EXTRA_CA_CERTS=)') \
     PORT=<free port> bun run dev:server
   ```

3. From `apps/web` in this worktree, signed in as a seeded persona on its own
   hostname:

   ```sh
   PARITY_BASELINE_URL=http://alice.localhost:<baseline port> \
   PARITY_BRANCH_URL=https://alice.localhost:<proxy port> \
   PARITY_LOGIN_EMAIL=alice@seed.macro.local \
   bunx playwright test --config tests/view-parity/playwright.config.ts
   ```

`PARITY_VIEWS=mail,tasks` runs some views. `--project phone` runs one device.
`PARITY_STORAGE_STATE=<file>` signs in from a saved Playwright storage state
instead of a seeded persona, for a backend that asks for an emailed code.
Screenshots go to `PARITY_OUTPUT` (default `/tmp/view-parity`).

The `file-*` views open file blocks that `seed/scenarios/view-parity-files.json`
creates for its own persona. Apply it as well, then run them signed in as
`PARITY_LOGIN_EMAIL=pat@seed.macro.local` with
`PARITY_VIEWS=file-image,file-video,file-code,file-unknown,file-pdf,file-canvas`.

A dev build serves thousands of modules per page, so the first run is slow.
Chromium drops in-flight requests whenever a network interface changes
(`net::ERR_NETWORK_CHANGED`), which leaves the page blank; on a machine running
several Docker stacks that happens often, so a view is retried up to three
times. On Linux, `isolated-network.sh` avoids the drops: it runs the command in
its own network namespace and forwards the two frontends' ports into it.

```sh
tests/view-parity/isolated-network.sh "<baseline port> <proxy port>" \
  bunx playwright test --config tests/view-parity/playwright.config.ts
```

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` where the bundled Chromium cannot
start. On a machine with no system fonts text has no size, so every
visibility wait fails: point `FONTCONFIG_FILE` at a config that lists a font
directory.

## Add a view

Add an entry to `views.ts` in the change that splits the view: where it opens,
how to tell it has loaded, and the states worth comparing (a detail opened from
its list, the title menu, the details sheet). Write the steps as a person would
perform them, so they also run against the build from before the split. Mark a
step only a touch device can take, such as tapping the title for its menu, with
`only: 'touch'`.

A failure prints the difference between the two builds, for every state, not
only the first that differs. Decide whether it is a regression or a change you
meant to make; an intended mobile change belongs in the pull request's
description, not in a looser comparison.

The harness opens a view the way its list does. A desktop block header is not
on that path: desktop opens documents, tasks and threads inline in their list
view, and mounts the block only for a preview. Compare it by hand at
`/app/home/<block-type>/<id>`, where Home previews the item in its block. A
document or task needs `?s0.drive.commentId=<any uuid>` as well; without it
Home shows its inline detail.

## What it cannot see

Chrome's device emulation is not a phone. The native apps stack panes and
swipe back, and have real safe areas and a software keyboard; check those in
the iOS Simulator (see `apps/web/AGENTS.md`) and on Android
(`docs/development/android.md`).
