# Sequences

Multi-step emails the server sends from the owner's own Gmail inbox to CRM
People. The server owns all sequence state; this feature only calls the
`/email/sequences` API through `@service-email/client`. Customers mounts it
behind `enable-sequences`: `sequences.tsx` is the entry point CRM loads lazily
(sidebar item, main pane, contact card), and `add-to-sequence.ts` is the small
launcher the People and Companies actions and the app shell's dialog host
share. People search and a company's people reuse CRM's contact queries
through `crm/record-adapter.ts`.

A sequence can be edited at any time; a save sends only the changed fields and
reaches every email not yet created. The server refuses a save that would
leave an active sequence incomplete, and the editor keeps the local draft and
shows why. Sent emails live in Mail and on the CRM person, not here.

```text
core/        status and action rules, draft diffing, limits
context/     source contracts and the provider
queries/     keys, query/mutation factories, cache updates, source adapters
primitives/  editor draft (autosave, refused saves)
components/  presentation; text in lib/i18n/locales/en/sequences.ts
views/       sidebar item, list, detail, enrollments, enroll dialog, contact card
```

Personal data (addresses, names, subjects, bodies) renders under
`ph-no-capture`. Tests: `bun run test -- src/features/sequences`.
