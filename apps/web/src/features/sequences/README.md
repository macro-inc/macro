# Sequences

Multi-step emails the server sends from the owner's own Gmail inbox to CRM
People. The server owns all sequence state; this feature only calls the
`/email/sequences` API through `@service-email/client`. Customers mounts it
behind `enable-sequences`: `sequences.tsx` is the entry point CRM loads lazily
(sidebar item, main pane, contact card), and `add-to-sequence.ts` is the small
launcher the People actions and the app shell's dialog host share.

```text
core/        status and action rules, editor draft diffing, limits
context/     source contracts and the provider
queries/     keys, query/mutation factories, cache updates, source adapters
primitives/  editor draft state (save, conflict, discard)
components/  presentation; text in lib/i18n/locales/en/sequences.ts
views/       list, detail, enrollments, enroll dialog, contact card
```

Personal data (addresses, names, subjects, bodies) renders under
`ph-no-capture`. Tests: `bun run test -- src/features/sequences`.
