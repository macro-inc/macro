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
- `queries/executed-pdf.ts`: the downloadable PDF, drawn page by page on a
  canvas (documents with their printed fields, then the certificate) and
  written with `block-pptx/core/pdf`. It receives the certificate as words
  (`components/certificate-sheet.ts`), so it knows no language.
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

- Add a packet operation to the store: wrap it in `traced` (`queries/traced.ts`)
  with a static `contracts.<area>.<verb>` name and ids or counts only.

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
  (`queries/exclusive.ts`), redoes the change if storage moved before it
  could be stored (the only protection in a browser without Web Locks),
  reports a write the browser refuses, and never replaces a snapshot it cannot
  read. Do not write the snapshot any other way.
- Paints of one PDF run one at a time (`queries/pdf-document.ts`), and a
  paint whose page scrolled away is skipped. Pass `renderPage` a real
  `wanted` check; `PdfPage` releases its bitmap when a paint fails.
- What a signed field prints lives in `core/printed-fields.ts`, and the
  signature faces in `core/signature-style.ts`. The page and the PDF both
  read them; change printing there, not in one renderer.
- Merging keeps the source's log whole under `merged`, never spliced into
  the target's chain: each event's hash depends on the one before it.
- The store's clock records expiry and due reminders (`onSchedule`). A
  transition that returns its packet unchanged writes nothing, so the clock
  is free when nothing is due.
- The audit chain shows consistency of the entries present, nothing more:
  the browser holds the log and could rewrite it. Do not word UI or docs as
  if it proved authenticity or completeness.
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
