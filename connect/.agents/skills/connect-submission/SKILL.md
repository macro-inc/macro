---
name: connect-submission
description: Run a vendor OAuth app submission for Macro Connect, from requirements to approval. Use when registering Macro Connect's own OAuth app with a vendor, filing or answering an app review, or advancing a record in `connect/submissions/`.
---

# Vendor OAuth app submission

One vendor per run. The record format, states, and human gates are in
`connect/docs/submissions.md`; read it first. The record is
`connect/submissions/<vendor>.md`; create it from that format if missing.

1. **Requirements.** Read the vendor's current developer docs for app
   registration and review. Fill the record's "Requirements" checklist, one
   linked item each: account type, app fields, required pages (privacy, terms,
   homepage), domain verification, demo video, security assessment, reviewer
   SLA, user caps before approval, costs. Re-read the docs whenever the record
   is older than a week.
2. **Scopes.** List the narrowest scopes the app's MCP server needs, with a
   one-line justification each. Split scopes that trigger a heavier review
   into their own request so they don't hold up the rest.
3. **Draft.** Fill every form field offline in the record first. Reuse
   `connect/submissions/answers.md` verbatim; mark new wording for the human's
   approval. Record the demo video with a browser agent against the real
   connect flow when the vendor wants one.
4. **Human gates.** For each step only a human can take (see
   `submissions.md`), add one ready-to-do item to the human queue in
   `connect/STATUS.md` and set `state: needs-human`. Prepare everything else
   first so the human's part is one sitting.
5. **Submit** through the vendor's portal in the browser, signed in as
   `connect@macro.com`. Store any client ID and secret in Doppler project
   `connect-api` (`<ID>_CLIENT_ID`, `<ID>_CLIENT_SECRET`) without printing them.
   Set `state: submitted` and `submitted`.
6. **Correspond.** Check `connect@macro.com` and the portal for reviewer
   messages. Answer the same day; log each exchange in the record. A request
   that changes scope or wording beyond `answers.md` goes to the human first.
7. **Update the record**: `state`, `last_contact`, `next_action`,
   `next_action_owner`, `due`. On approval, set the catalog app's `status` to
   `live` (run `connect-add-app` to re-check it) and log where the secrets
   live.

Done when the record's state moved forward or its blocker is in the human
queue, and `next_action`, owner, and `due` say exactly what happens next.
