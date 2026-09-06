# Local email verification with recorded Chrome evidence

This audit follows the email restructuring and simplicity pass. The previous
[verification report](EMAIL_REFACTOR_VERIFICATION.md) records the comparisons
against the original implementation and the committed compatibility baseline.
This pass expands the integration coverage with actual local services and a
synthetic mailbox. It does not replace the previous before/after comparisons.

The reproducible suite is [tests/e2e/email-review](../apps/web/tests/e2e/email-review/README.md).
Its recorder produces a video per scene, a screenshot, assertions, observed email
requests, cleanup results, source revision, source diff hash and run timestamp.
The video renderer accepts one complete passing run; it rejects mixed takes.
The assembled MP4 contains chapters, and an HTML player links to each chapter.

## Seed and environment

Run `nix develop --command just run_local --instance email-feature-eval
--port-base 24700 --no-doppler --with-chrome --no-build` with compatible local
binaries. The frontend is this worktree's Vite server at `localhost:24710`;
requests use the isolated API proxy at `24709` and shared Chrome at `9222`.
The README documents generation, application, authentication, storage setup and
recording commands. Generated seed data and private authentication state remain
under `/tmp/email-exhaustive-review`, outside version control.

The Atlas launch scenario contains:

- Alex, a paid account; Maya, a collaborator; and a free guest with a read-only
  shared thread and a separate mailbox.
- A primary work inbox, a secondary studio inbox, a delegated support inbox and
  the guest inbox; distinct signatures and synthetic correspondents.
- Seventeen threads: an eight-message conversation with a saved middle reply,
  120-message history, invitation and accepted-response HTML, newsletter,
  personal HTML, plaintext, Macro Markdown, wide table, attachments, mailto,
  draft-only, sent-only, shared/read-only and failure-recovery cases.
- Real stored text, calendar and image bytes; received attachment/document
  mappings; a CID image in static-file storage; mentionable documents in history.
- A pending AI SendEmail tool output and an actual email notification.

The seed's Gmail accounts have no provider OAuth grants. The harness holds their
health checks and `needs_reauth` state healthy so a reconnect prompt does not
obscure unrelated controls. Local compatibility listeners map storage URLs to
this port window's real LocalStack objects. Those are environment substitutions,
not verification of Google connectivity. Every chapter and the introduction
identify the substitutions. Fault cases identify their additional intercepted
responses explicitly.

## Coverage inventory

A scene passes only after its listed assertions pass. Desktop and touch contexts
use the same mounted application; mobile is Chromium device/viewport emulation.
The assertions inspect UI, real persisted data or requests as appropriate.

| Capability | Recorded cases | Evidence |
| --- | --- | --- |
| Mail lists and inbox isolation | 01 | Signal, Noise, Sent, Drafts, All and studio selection |
| Thread order, details and quotes | 02 | Eight-message chronology, saved middle reply, details, navigation and quoted content |
| Pagination and message links | 03, 24 | Real 120-message history, older page requests, deep-linked message, hidden-message Enter/Escape |
| HTML and Markdown rendering | 04 light/dark | Calendar text contrast, response banner, themed links, newsletter/personal HTML, plaintext/Macro Markdown, wide-table containment |
| Mailto | 05 | Existing recipient-prefill behavior; subject/Cc/body prefill is not asserted |
| Read-only shared thread | 06 | Visible message with Reply/Forward/editor unavailable |
| Standalone compose | 07, 21 | To/Cc/Bcc, subject, formatted body, signature, real save/reload/discard; desktop and mobile |
| Reply, reply-all and forward | 08, 20 | R, Alt/Option+R and F; selected/latest targets, editor identity, forward To focus, saved reply and touch drawer reopen |
| Send and Undo | 09 | Real local send queue request, immediate unschedule, draft recovery |
| Scheduling | 10 | Tomorrow schedule, persisted time after reload, real unschedule |
| Received inline images | 11 | CID resolves to static-file storage and decodes to a nonzero image width |
| Received files | 12 txt/ics | Real attachment-to-document routing, viewer, download event and byte equality with seed files |
| Uploaded files | 13 | File chooser, real metadata/storage, reload, removal and 18 MB limit |
| Forwarded files | 14 | Real forwarded-attachment records, pointer and keyboard removal, received originals retained |
| Send failure and retry | 15 | Explicit HTTP 500, preserved form and identical retry payload |
| Thread load failure | 16 | Explicit initial HTTP 500, visible retry and real recovery |
| Read/unread and done/not-done | 17 | Real email mutations and Undo |
| Primary, secondary and delegated From | 18 | Sender, signature, body and correct inbox headers across switches |
| Recipient interaction | 19 | Invalid address, duplicate handling and To-to-Cc drag |
| Mobile layout | 20, 21 | Touch reply/forward drawer, Cc/Bcc, close/reopen, reduced viewport and standalone compose |
| Navigation persistence and local editor history | 22 | Latest pending standalone edit survives SPA navigation; editor undo/redo |
| Independent split state | 23 | Expansion, selected reply target and saved draft stay local to their thread |
| Free-account watermark | 25 | Outgoing watermark and editor cleanup after explicitly failed send |
| AI compose consumer | 26 | Seeded real tool consumer; no save solely from initialization; complete body-only edit saved through tool API and restored after reload |
| Document mentions | 27 | Real menu selection and saved HTML retaining the actual document ID |
| Sender commands | 28 | Original correspondent, distinct Signal/Noise values, real block and cleanup unblock |
| Upload recovery and send ordering | 29 | Injected first upload failure, metadata rollback, real retry bytes, send waits for unfinished upload; final delivery deliberately fails |
| Pasted image | 30 | Editor paste, real static-file upload and persisted uploaded image identity |
| Secondary and delegated completion | 32 | Fresh direct entry archives the correct inbox thread and Undo restores it |
| Notification completion and Undo | 31 inbox/direct | Real notification done state and archive request; Undo restores both and survives reload from inbox navigation and fresh direct entry |

Download evidence transparently captures the application's actual Blob because
Chrome runs in a container and its download path is not host-local. The test
also waits for the real browser download event and checks its filename and
completion. Pasted images use a synthetic ClipboardEvent carrying a real File;
this exercises the editor and upload pipeline, not OS clipboard permissions.

## Bugs found and fixes

These issues were found by expanding behavioral checks. Source inspection shows
the missing reply-all command, standalone disposal loss, AI body-only loss and
cold-entry completion fallback existed before this simplicity pass; parity alone
would preserve them. The audit fixes them rather than treating baseline behavior
as sufficient evidence of correctness.

| Trigger | Failure | Correction |
| --- | --- | --- |
| Alt/Option+R | Registered action had no matching handler | Wire the existing reply-all action to the selected/latest message; test real thread state |
| Leave standalone compose before debounce | Latest edit was cancelled with the owner | Capture pending form/editor content on disposal and serialize saves; do not resurrect sent/discarded drafts |
| Send/discard overlaps another action | Sender, schedule or repeated discard could race the pending operation | Guard the operation through completion, preserve retry on failure and keep captured inbox identity for queued uploads |
| Edit only AI email body | Snapshot compared recipients/subject but omitted body | Compare the prepared body too; initialize the snapshot from imported editor HTML |
| Click forwarded attachment X | Focusing the message card scrolled the control between pointerdown and click | Use a named button and preserve editor focus for pointer and compatibility mouse events |
| Mark done after fresh direct navigation | Archive-only fallback left the notification active | Build the missing action entity from the loaded thread and use the existing combined completion/Undo action |

The controller tests exercise real Lexical state and injected feature-owned
services: latest disposal flush, untouched and settled drafts, in-flight ID reuse,
failed/duplicate send, discard races, upload completion and captured inbox. The
shared mark-done action tests retain its existing notification/Undo contracts.
No dependency or backend production code was added.

## Verification limits

This run covers the inventory above, with earlier renderer parity results and
independent Node/Chromium tests as complementary evidence. It cannot establish
that arbitrary email HTML, every account configuration or every device is free
of bugs.

- Provider delivery, Gmail synchronization, reconnect/OAuth and provider-side
  calendar RSVP require a connected test account. Local sends are immediately
  undone; teardown cancels any remaining scheduled messages and removes only
  drafts created by the recorder. No external message delivery is claimed.
- AI output is seeded. The real mounted consumer, permissions and persistence
  are exercised; LLM generation and external AI-triggered delivery are not.
- Touch mode and reduced viewport do not reproduce a physical keyboard, iOS
  WKWebView, Tauri's native image path or device-specific focus behavior.
- The local first-login landing initially showed an inbox error. Login setup
  navigates to the email surface after authentication; first-login onboarding
  and the global Inbox surface are not certified by this email audit.
- Forwarded quoted previews retain `cid:` image references that the editor does
  not resolve. This is pre-existing behavior. Received CID images and ordinary
  forwarded file attachments pass their separate checks; forwarded inline-image
  preview and provider delivery are not claimed as working.
- Both R and the visible Reply action currently invoke reply-all. Case 08 checks
  that existing behavior and Alt/Option+R; it does not certify a separate
  sender-only Reply UI.
- Mailto retains its existing To-only behavior. Read-only coverage checks the
  mail UI, not a complete backend authorization penetration test.

Exact run counts, source identity, timestamps and cleanup results are in the
recording's `results.json`; the HTML player lists every successful assertion.
