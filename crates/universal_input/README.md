# Universal Input inference

The web client exposes this composer through Command K and mobile Search.
The `enable-universal-input` feature flag is the only activation control; there
is no Settings toggle, account-domain restriction, or saved opt-out. Home keeps
its normal composer. Command K drafts are discarded when the menu closes.
On mobile, the card replaces the normal results and category tabs, above the
expanding Search input and virtual keyboard. Clearing the input restores search.

The composer classifies draft snapshots with the same Jev classifier used by
Routines. When configured, Cloudflare Clairic extracts editable fields through
Workers AI. Clairic uses typed text and list fields for the selected intent.
Task deadlines and event timing are extracted separately by Nemotron as structured
expressions with exact source spans; Rust resolves them against the request clock
and timezone. Task properties are separate lists keyed back to the supplied catalog;
property names and entity IDs are never invented by the model. Domain-owned
typed field definitions are specific to the intent and avoid chat/JSON instructions. Inference is read-only;
submission uses the existing destination services and their permission
checks. The domain service validates input and checks AI admission before calling
either provider. Usage is recorded through the shared recorder.

All extraction instructions live in [prompts/](prompts/README.md): shared and
intent-specific guidance, individual Clairic fields, and temporal instructions.
Rust embeds these files and assembles them with schemas and task-property data.

The crate owns its authenticated Axum router. `agent_harness_service` mounts
`POST /universal_input/classify` and `POST /universal_input/extract` directly,
without the cognition prefix. The harness root composes providers. Configure the existing
`TYPESAFE_API_KEY` through the consolidated harness Doppler configuration to enable
automatic classification. To try Clairic, set `CLOUDFLARE_ACCOUNT_ID` and
`CLOUDFLARE_API_TOKEN` together in the harness configuration (and in
the local stack's `local/lcl_personal` configuration or its integration env file).
The token needs Workers AI access for that account. These stay on the backend.
An incomplete pair fails at startup; absent/blank pairs retain Nemotron.

The domain's fallback extractor calls Nemotron Lightning 3.5 through Fireworks
when Clairic is unconfigured, fails, times out after five seconds, or returns
malformed/truncated answers, uncertain positive values, incomplete outgoing
bodies, or search fields that reuse the same source occurrences. Nemotron still
requires `FIREWORK_API_KEY` from the existing shared-AI configuration, with reasoning disabled and native
JSON-schema enforcement. Rate limits fall back immediately instead of retrying
the preview endpoint. Usage is recorded separately for each provider that reports
tokens, including unusable Clairic answers. The pricing seed is $0.10 per million
Clairic input tokens and zero output cost, as documented by Cloudflare.

Clairic text is extractive: titles, subjects, outgoing bodies, and search terms
select source spans instead of rewriting them. The domain preserves entire notes
verbatim and derives a missing email subject from the extracted outgoing body.
Text/list answers must occur in the draft. True nulls remain unset; uncertain
nonempty answers invoke the existing fallback, never the provider's `guess`.
Outgoing email/chat spans must reach the end of the draft to prevent truncated
bodies from silently discarding later sentences. This check detects an early end,
not a missing opening sentence. Temporal extraction returns source facts rather
than final timestamps. Rust applies calendar-week semantics for this/next weekdays,
validates source spans and local DST boundaries, and supplies defaults. Absolute
dates must ground their numeric day and optional year in the selected source span;
spelled-out numeric dates remain unresolved. A recurrence cutoff cannot precede
the first occurrence. Clairic
continues to extract content, invitations, task properties and search filters. No regular expressions
reinterpret their answers. Source-span and confidence checks do not guarantee
semantic accuracy; live provider evaluation is required separately from UI tests.
Manual edits retain precedence.
Without Jev configuration, the composer supports manual type selection. Running
only the frontend against a backend without these routes also requires manual
field entry.

The client throttles inference at 200 ms intervals while typing and coalesces
classification and extraction independently, with one request in flight per
queue. Each queue coalesces changes to the newest text, so slow field extraction
does not block type prediction. The classifier selects the destination; no local
prefix parser overrides it.
Selected forms preserve the source while extraction refines unedited fields. The
strongest candidate starts a draft even when scores are close. Completed
predictions may reveal a shape
while typing continues; manual choices and edits invalidate older predictions.
Cmd/Ctrl+Shift+Right cycles ranked types, and Left cycles backward. Submission
waits for the current draft to finish updating. Unit tests and the browser fixture use controlled provider
responses; they do not establish live model accuracy or latency.

For repeatable comparisons, use the [fixed-clock behavior baseline](eval/README.md).
It records actual intent/field mismatches and compares saved reports without
submitting any actions.

Before evaluating a configured stack, try these drafts without submitting them:

| Draft | Expected shape |
| --- | --- |
| Explain how database indexes work | AI |
| Find the email from Alice about the launch | Search |
| Email john@example.com that I'll be late | Email, with visible outgoing body |
| email julia followed by can we reschedule the thing tomorrow? let the investors know | Email to Julia; requests and dates remain in the outgoing body |
| Remind me to email Julia tomorrow about rescheduling | Task, despite mentioning email |
| # Research notes followed by observations | Markdown note |
| Finish the launch report by Friday | Task with a due date |
| Call John at 3pm tomorrow | Event at local 3 PM, one hour, no guests |
| Call with Julia tomorrow at 7 | Event at local 7 PM, one hour, editable AM/PM cue |
| Notification click not going to target followed by priority urgent | Task with Urgent priority, metadata removed from description |
| DM John that I'm running five minutes late | Message with recipient resolution |
| John | Start the strongest candidate; alternatives remain available |

Also test partially typed drafts, changing intent, duplicate names, explicit guest
invitations, timezone boundaries, and provider failure. A manually edited field
locks the type and survives subsequent inference. Use Auto to resume detection.

Extraction receives the available task property names and options. Suggested
property display values resolve only against actual options and visible entities;
model output never grants access or invents entity IDs. Unknown or ambiguous
values require a manual choice. Rust resolves relative date expressions in the
user's timezone. Event timestamp normalization accepts seconds and RFC3339
offsets, while rejecting nonexistent or ambiguous local DST times. The model
extracts explicit end times and durations, task descriptions without
metadata, and search keywords/category/sender/channel fields. The client maps the
extracted category to supported filter types and resolves names through the real
directory. Search waits for extraction and unresolved names require a choice.
The domain supplies a one-hour elapsed duration when no end was supplied.
Explicit equal, reversed or invalid ends remain unresolved; local DST boundaries
are validated. Ambiguous-hour
cues use model-provided source phrases rather than scanning the draft again.


Email creation includes separate To, Cc and Bcc recipients, with the existing
recipient selectors and delivery pipeline. Calendar creation includes recurrence,
using the existing recurrence selector, custom builder and RRULE serializer.
Manual edits, including clearing recurrence, take precedence over later inference.
Replies, forwards, thread targeting and updates to existing entities are follow-up
scope: this flow creates new entities or searches existing content. It never
selects an existing email thread or edits an existing event implicitly.

Suggestions are a tagged enum: the intent and its applicable payload travel
as one value. Field guidance is compile-time Rust data rather than a separate JSON
catalog. Destination services still own creation authorization and persistence.
