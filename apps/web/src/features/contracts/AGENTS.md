# Contracts

## What it is

The Contracts module: databases of signing packets, the packet drawer, the
new-packet flow (set up, place fields, review and send), the public signing
page, and the Certificate of Completion. Gated by `enable-contracts`.

## How it works

Packets live in the browser for now. `queries/local-contracts.ts` runs the
lifecycle in `core/` against localStorage (packets) and IndexedDB (PDF bytes)
and implements the two contracts in `context/`: `ContractsContext` for the
workspace and `SigningContext` for a signing link. Each signed-in account has
its own snapshot key and document store (`browser-contracts.ts`); a signing
link finds the account that issued it by its token. The workspace mounts once
per confirmed sign-in (`PerSignIn` over `useQueryAccount`): it closes while a
new login is being confirmed, and a closed store refuses late writes. The signing engine will
replace that adapter behind the same contracts; nothing above `queries/`
knows where packets are stored. No email is sent: a sender copies a signing
link from the packet drawer.

## Start here

- `core/lifecycle.ts`: every packet transition (send, view, sign, decline,
  void, expire, replace a document, mark signed offline) as a pure function.
- `core/status.ts`: the packet status. It is derived, never stored.
- `core/audit.ts`: the event hash chain and the packet state digest.
- `context/contracts-context.tsx`: what the views need from a host.
- `contracts.tsx` / `signing.tsx`: production wiring for `/contracts` and
  `/sign/:token`.

## Scope

- Owns: packets, their fields and events, placement, signing, the certificate.
- Not here: PDF viewing and markup for Drive documents → `features/block-pdf`;
  the shared database editor → `features/database`.

## Recipes

- Add a packet transition: `core/lifecycle.ts` (+ test) →
  `context/contracts-context.tsx` → `queries/local-contracts.ts` → the view.
- Add a field kind: `core/packet.ts` `FIELD_KINDS` → `core/fields.ts` →
  `components/field-kind.tsx` → `components/signing-field.tsx` →
  `queries/packet-schema.ts`.
- Add user-visible text: `lib/i18n/locales/en/contracts.ts`.

## Checks

- `bun run test src/features/contracts`
- `bunx playwright test --config src/features/contracts/browser-test/playwright.config.ts`
  drives the real views over the real local adapter: a packet from upload to
  certificate across two tabs, every status in a seeded database, and signing
  on a phone. `workspace.html?seed=demo&now=<ISO time>` shows the seeded
  workspace.

## Gotchas

- A PDF page is white in every theme. Text and marks drawn on it use fixed
  colors or `--tone-print`, never theme tokens such as `text-ink`.
- Field text sizes are `cqw` of the page (`PdfPage` is the container), so a
  field keeps its proportions at any page width. Do not make a field wrapper a
  size container; `SignatureMark` carries its own.
- Another tab can receive a change notice before its copy of localStorage has
  caught up. `queries/change-feed.ts` follows the `storage` event as well;
  keep both.
- Every write goes through `mutate` in `queries/local-contracts.ts`: it reads
  storage, changes, and stores inside one cross-tab lock
  (`queries/exclusive.ts`), reports a write the browser refuses, and never
  replaces a snapshot it cannot read. Do not write the snapshot any other way.
- A placement store holds Solid proxies. Save `placement.snapshot()`, never
  the proxies: they cannot be cloned or compared across writes.
- Iterate packets and fields with `Key` on their id, not `For`: every store
  write replaces the objects, and `For` would remount the row or the field
  being typed in.
- Replacing a document clears every signature and issues new links
  (`replaceDocument`); a used, voided, or expired link opens nothing.
- Key mounted views on a packet's id, not the packet object: every store
  write replaces the objects, and a view keyed on one remounts. `PlaceFields`
  must be keyed that way; its placement belongs to one packet.
- A signer's consent is its own step (`acceptDisclosure`); `signPacket`
  refuses without it. Signing also needs every document to have opened.

## Related

- Rules: `.agents/rules/web/architecture.md`, `.agents/rules/web/mobile.md` ·
  Docs: `docs/agent-guide/contracts.md`
