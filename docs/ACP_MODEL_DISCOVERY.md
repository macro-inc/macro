# ACP model discovery

Status: design sketch.

## Goal

Let the agent settings UI load the models a selected harness actually offers
before an ordinary agent session exists. Cursor, in-memory, and registered
macrod harnesses should all produce the same response shape from the same ACP
source: the `model` entry in `configOptions`.

This first version deliberately has no application cache. Loading the settings
page or selecting a different harness may run a fresh probe. The design keeps a
cache boundary explicit so one can be added without changing the API or UI.

## Important distinction

The fold does not discover models. It projects ACP frames into
`SessionMetadata.supported_models`.

Today `agent_fold` recognizes the `configOptions` returned by `session/new`,
`session/load`, `session/resume`, and `session/set_config_option`. It finds the
select option whose id is `model`, then records its current value and choices.
That projection is the behavior model discovery should share.

Discovery therefore has two layers:

1. A provider-specific probe obtains a `session/new` response from an ACP
   agent.
2. One provider-independent projector turns its `configOptions` into model
   metadata.

The transports cannot be completely unified: Cursor is an in-process pipe,
in-memory is an in-process channel, and macrod owns a subprocess on another
machine. Everything after the `session/new` response can be identical.

## Proposed product API

The settings UI loads only the currently selected harness. It should not start
one probe for every registered harness when the dialog opens.

```http
POST /agent-models/load
Content-Type: application/json

{
  "harness": "macrod",
  "harnessId": "019...",
}
```

Built-in harnesses omit `harnessId`:

```json
{ "harness": "cursor" }
```

The response uses the fold's existing model vocabulary:

```json
{
  "status": "available",
  "currentModel": "default",
  "models": [
    {
      "id": "default",
      "name": "Auto",
      "description": null
    }
  ]
}
```

`status` is:

- `available` when the ACP agent advertised a model select, even if its option
  list was empty.
- `unsupported` when the ACP agent completed the handshake but did not
  advertise a model select.

Operational failures are HTTP errors rather than an empty successful catalog:

- `409` when a registered macrod harness is disconnected.
- `424` when the harness process cannot be started or exits during discovery.
- `504` when `initialize` or `session/new` times out.

`POST` is intentional. Although the result is read-only product data, a probe
starts a process or task and creates temporary ACP session state. Browsers,
proxies, and query clients must not treat it as a freely replayable `GET`.

## Domain shape

Put the use case beside harness routing, not in an axum handler or in the
settings frontend.

```rust
pub struct LoadModels {
    pub actor: MacroUserId,
    pub harness: HarnessTarget,
}

pub enum HarnessTarget {
    InMemory,
    Cursor,
    Macrod(HarnessId),
}

pub struct ModelCatalog {
    pub current_model: Option<String>,
    pub models: Vec<ModelOption>,
}

pub trait ModelProbe {
    async fn load_config_options(
        &self,
        request: LoadModels,
    ) -> Result<Vec<SessionConfigOption>>;
}
```

`ModelCatalogService` authorizes the target, dispatches to `ModelProbe`, and
passes the returned options to a shared projector. The inbound HTTP adapter only
parses the request and maps typed errors to status codes.

This is a separate use case from `ContainerManager`. Discovery neither owns a
normal Macro session nor implements `spawn`, `resume`, or `teardown`.

## Share the fold's projection

Extract the model-specific part of
`agent_fold::FoldState::apply_config_options` into a public, total function:

```rust
pub struct ModelSelection {
    pub current: String,
    pub options: Vec<ModelOption>,
}

pub fn model_selection(
    options: &[SessionConfigOption],
) -> Option<ModelSelection>;
```

The live fold calls this function and updates `SessionMetadata`. The discovery
service calls the same function and returns `ModelCatalog`. Tests for grouped
and ungrouped selects, descriptions, ordering, and non-model config options
remain owned by `agent_fold`.

Do not instantiate a fake `FoldMachineImpl` or synthesize persisted log entries
for discovery. That would couple a read-only catalog to message ids, request
correlation, and session history merely to reach a small pure projection.

## Common ACP probe

For providers whose transport is local to the service, use one small ACP client:

```text
open ephemeral transport
  -> initialize
  -> session/new with an empty MCP list and a temporary working directory
  -> read configOptions
  -> close transport
```

The probe never sends `session/prompt`. This is load-bearing for Cursor: its
cloud agent is created lazily on the first prompt, so model discovery creates no
Cursor cloud agent.

ACP has no portable `session/destroy` request. Cleanup means closing the
ephemeral transport and allowing the provider adapter to end the task or child
process it owns. The probe must have independent initialize and session-open
timeouts and a total deadline.

The working directory is part of the probe input because some ACP agents derive
configuration from a project. The first settings version uses a documented
neutral directory. A catalog is therefore harness-level availability, not a
promise that every repository exposes exactly the same models.

## Provider adapters

### Cursor

Resolve the authenticated user's Cursor key exactly as a normal Cursor session
does, start `CursorSessionService` over a duplex pipe, and run the common probe.
Dropping the pipe ends the service task.

This replaces the settings-only `GET /cursor-api-key/models` path after the new
path is proven. Keeping both indefinitely would allow the session picker and
settings picker to disagree.

### In-memory

The in-memory ACP agent currently accepts `session/set_config_option` but its
`session/new` response does not advertise `configOptions`. Make it return a
model select describing the model or models the in-memory engine can actually
run. Then execute the common probe over an ephemeral in-process channel.

The frontend-owned `IN_MEMORY_HARNESS` model list can be removed once this path
ships.

### Registered macrod

The server cannot start the operator's configured ACP command. Add a
request/response operation to the runtime protocol:

```text
agent_harness_service                  macrod
        |                                |
        |--- load_model_config(id) ----->|
        |                                | spawn configured ACP child
        |                                | initialize
        |                                | session/new
        |                                | capture raw configOptions
        |                                | close child transport
        |<-- model_config(id, options) ---|
```

The correlation id is not an `AgentSessionId`; no `agent_session` row is
created. The macrod adapter returns raw `SessionConfigOption` values so the
server still uses the same projector as Cursor, in-memory, and live folds.

Keep this control exchange distinct from the existing multiplexed ACP frames.
It is connection-level runtime control, not traffic for a persisted session.
Only one model probe per harness should be in flight at a time to prevent
repeated UI actions from starting multiple child processes.

Closing the child's stdio and waiting for it to exit is the normal cleanup.
After a short grace period macrod may terminate that specific child process.
It must never kill processes by executable name.

## Authorization

- Cursor discovery uses only the caller's registered Cursor credential.
- In-memory discovery requires an authenticated user but no harness ownership.
- Macrod discovery verifies that the caller may use the requested harness
  before reading its live connection.
- A runtime response is accepted only from the authenticated connection for
  that `HarnessId` and only for an outstanding correlation id.

The catalog contains no credentials, command arguments, environment values, or
working-directory contents.

## Settings behavior

The Agents dialog should:

1. Render the harness selector immediately.
2. Start a model load when the selected harness changes.
3. Disable the model selector and show a loading state during the probe.
4. Render the returned models with their ACP labels and descriptions.
5. Include the saved model if it is no longer advertised, marked
   `Unavailable`.
6. Show a retry action for operational failures.
7. Show `This harness does not advertise models` for `unsupported`.

There should be no arbitrary free-text model field in the normal flow. If
custom model ids are still needed, expose them as an explicit advanced action
rather than silently treating every string as valid.

The Harness settings page's Cursor default picker and the Agents dialog should
eventually use this same query. Whether a selected value is a global
provider default or an agent-config default remains a separate write concern.

## Concurrency and lifecycle

- Cancel the UI request when the user changes harness, but do not assume HTTP
  cancellation reached the provider. The service still closes its probe.
- Coalesce concurrent loads for the same connected macrod harness while they
  are in flight. This is concurrency control, not a result cache.
- Do not persist ACP session ids, fold logs, or external-agent rows.
- Do not call provider teardown for a normal Macro session.
- Never send a prompt.

Some third-party ACP agents may allocate external resources during
`session/new`, even without a prompt. ACP does not guarantee Cursor's lazy
behavior. The macrod probe documentation must state this, and a future
capability-only protocol extension may be preferable for providers where
opening a temporary session is expensive.

## No-cache first version

Every successful load result is discarded after the HTTP response. React Query
should use `staleTime: 0` and key requests by the full harness target.

The service boundary should nevertheless be:

```text
HTTP -> ModelCatalogService -> ModelCatalogSource -> ACP probe
```

Initially `ModelCatalogSource` delegates directly to the probe. A later
`CachedModelCatalogSource` can wrap it with a TTL and last-known result without
changing the handler, response, or UI. Cache invalidation and persistence are
explicitly out of scope for this version.

## Testing

### Projection

- The extracted fold function maps grouped and ungrouped model selects.
- It preserves model order, ids, names, and descriptions.
- It ignores unrelated config options.
- The live fold produces the same metadata as before extraction.

### Probe

- A fake ACP agent returning models completes after `session/new` without
  receiving a prompt.
- Missing model configuration returns `unsupported`.
- Initialize, open, transport, and timeout failures remain distinguishable.
- Dropping or timing out a probe closes its transport.

### Providers

- Cursor discovery does not call `create_agent`.
- In-memory advertises the engine's actual supported model set.
- macrod correlates concurrent responses, rejects a response from the wrong
  harness, and closes the exact child it started.
- A disconnected macrod harness fails without creating a session row.

### API and UI

- Authorization is enforced for another user's macrod harness.
- Switching harnesses cannot display a late result from the previous harness.
- Loading, available, unsupported, disconnected, failure, and stale saved
  selection states render explicitly.
- Selecting an advertised model submits its exact ACP id as `default_model`.

## Suggested implementation order

1. Extract and test the pure model projector from `agent_fold`.
2. Add in-memory `configOptions`.
3. Build the local ACP probe and Cursor/in-memory adapters.
4. Add the macrod runtime control exchange and subprocess probe.
5. Expose the load endpoint and SDK method.
6. Replace provider-specific model assembly in the settings UI.
7. Remove the old Cursor settings model endpoint and frontend constants after
   migration.

## Deferred

- TTL or durable caching.
- Background refresh and last-known catalogs.
- Workspace-specific catalogs.
- Model variant controls such as effort, reasoning, or fast mode.
- A dedicated ACP capability that lists models without `session/new`.
