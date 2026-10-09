# Home input inference

Desktop Home classifies draft snapshots with the same Jev classifier used by
Routines, then extracts editable fields with the shared fast model. Inference is
read-only; submission uses the existing destination services and their permission
checks. The domain service validates input and checks AI admission before calling
either provider. Usage is recorded through the shared recorder.

The document-cognition service hosts authenticated `POST /universal-input/classify`
and `POST /universal-input/extract` endpoints. Configure its existing
`TYPESAFE_API_KEY` through the document-cognition Doppler configuration to enable
automatic classification, alongside the normal fast-model provider credentials.
Without Jev configuration, the composer supports manual type selection. Running
only the frontend against a backend without these routes also requires manual
field entry.

The client debounces inference, coalesces requests, ignores stale revisions, and
only chooses an intent at score >= 0.80 with a >= 0.20 margin. These are experimental
thresholds. Unit tests and the isolated browser fixture use controlled provider
responses; they do not establish live model accuracy or latency.

Before evaluating a configured stack, try these drafts without submitting them:

| Draft | Expected shape |
| --- | --- |
| Explain how database indexes work | AI |
| Find the email from Alice about the launch | Search |
| Email john@example.com that I'll be late | Email, with visible outgoing body |
| # Research notes followed by observations | Markdown note |
| Finish the launch report by Friday | Task with a due date |
| Call John at 3pm tomorrow | Event at local 3 PM, one hour, no guests |
| DM John that I'm running five minutes late | Message with recipient resolution |
| John | Neutral; offer types |

Also test partially typed drafts, changing intent, duplicate names, explicit guest
invitations, timezone boundaries, and provider failure. A manually edited field
locks the type and survives subsequent inference. Use Auto to resume detection.
