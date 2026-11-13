# Contracts

## What it is

The Contracts module: databases of signing packets, the packet drawer, the
new-packet flow (set up, place fields, review and send), the public signing
page, and the Certificate of Completion. Gated by `enable-contracts`.

## How it works

Packets live in the browser for now. `queries/local-contracts.ts` runs the
lifecycle in `core/` against localStorage (packets) and IndexedDB (PDF bytes)
and implements the two contracts in `context/`: `ContractsContext` for the
workspace and `SigningContext` for a signing link. The signing engine will
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
- Replacing a document clears every signature and issues new links
  (`replaceDocument`); a used, voided, or expired link opens nothing.
- Key mounted views on a packet's id, not the packet object: every store
  write replaces the objects, and a view keyed on one remounts.

## Related

- Rules: `.agents/rules/web/architecture.md`, `.agents/rules/web/mobile.md` ·
  Docs: `docs/agent-guide/contracts.md`
