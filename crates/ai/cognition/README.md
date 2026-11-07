# Shared cognition tools

`GenerateObject` and `Decide` are ordinary Macro tools available through the
shared `ai_tools` toolset. The code-mode SDK calls those same tools; it has no
provider client, separate AI service, or model credentials.

The domain `Cognition` port takes the authenticated acting user and typed
requests. Its HTTP adapter calls the existing cognition service:

- `GenerateObject` maps `{prompt, system?, model?, schema}` to
  `/structured-completion` with `toolset: {type: "none"}` and returns `{object}`.
  The optional model is a full provider/model identifier. The composition root
  supplies the existing shared default when it is omitted.
- `Decide` sends the shared Jev `DecisionRequest` to `/decisions` and returns
  `{probabilities}`. Each named yes/no question retains its original key.

The cognition service owns model access, admission, provider work, output-schema
validation, and usage metering. Tools cannot choose an acting user, change the
service destination, pass credentials, or enable nested tools. Callers supply
the source context; these operations do not fetch or modify Macro documents.

`ai_tools::build_cognition_tool_context` constructs one pooled client using the
existing cognition service URL and internal credential. The client forwards
trace context and the authenticated user. It bounds responses to 1 MiB and the
complete request to 28 seconds, with no redirects or automatic retries because
repeated provider requests can incur usage. Failures return actionable errors
without provider response bodies. Timeouts or cancellation can stop waiting
after provider work has already begun; recorded usage is retained by cognition.

Request limits are 64 KiB of combined generation prompt and system text plus a
16 KiB object-root JSON Schema. Decisions use Jev's shared validation: 1–32
questions and a 64 KiB complete JSON request. Response mapping rejects
interrupted generation, unexpected tool activity, missing probability keys,
and probabilities outside `[0, 1]`.

Tests cover trusted identity and endpoint mapping, model forwarding, strict
tool inputs, cancellation, request/reply limits, deadlines, redirects, safe
errors, and fake-port delegation. Run from the repository root:

```sh
cargo test -p cognition
```
