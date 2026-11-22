# Final merge-head checks

Runtime `f4bd312fc30` merges main `6449317189c`. Final source `f0740021328` adds only the reviewed sender-menu setup test fix ([diff](test-only-diff-stat.txt)). Main changes Home, Soup persistence/backfill, gateway ownership and DSS; the old movies are labelled with their recorded heads rather than treated as final-runtime film.

- [Smoke](smoke.json): connect, first sync, arrival without reload, SMTP acceptance plus Sent copy, restart catch-up in **5.406 s**, no reload, duplicate or resend.
- [Email/Home dialogs](dialogs.json): all four real list reloads return 200; chooser and typed IMAP form survive disposal of the old empty state; all five handoffs keep a backdrop. [11 matching spans](dialog-spans.json), with real completed/dismissed reasons and a non-null connected link ID.
- [Provenance](provenance.json): served frontend and all 18 running native executables verified. [Migration rehearsal](migrations.json): full pre-merge source on a fresh DB, then full merged source applies the older-versioned index normally. The preserved local ledger is deliberately unchanged.
- [Environment observations](local-environment.json): failed/diagnostic attempts retained privately, missing owned queues restored additively, final clean run passes.

All services and users are local lab stand-ins. SMTP acceptance is not recipient delivery. The phone movie is emulation; real-provider and oversized/unreadable-credential states are not exercised. No new movie is claimed for this merge. Human playback and real-provider verification are pending, not tested. Bead `mac-imap-smtp.19` stays open for the human trial; merge is held and nothing is deployed.

Final gates: [CI 45069273618](https://github.com/macro-inc/macro/actions/runs/45069273618),78 success / 18 skipped; [browser 45069272782](https://github.com/macro-inc/macro/actions/runs/45069272782),766 tests, 2 pre-existing retries, 2 skipped, 0 failed. Sender-menu 8/8 first-pass. The two unchanged main races are `mac-5aul` (composer caret jumps while typing) and `mac-6g1f` (phone saved-view reorder reads an empty list). [Gate receipt](gates.json). Backend45065813761 is green at f4 and carries over the test-only follow-up.
