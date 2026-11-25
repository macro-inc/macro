# LiteLLM provider

An optional OpenAI-compatible provider for the in-memory agent runtime. A
deployment that runs a [LiteLLM](https://docs.litellm.ai/) proxy can let its
agents use the proxy's models without changing the built-in provider list.

## Configuration

Set both variables on `agent_harness_service`:

| Variable | Meaning |
| --- | --- |
| `LITELLM_BASE_URL` | The proxy's OpenAI-compatible base URL, including its version prefix, e.g. `https://litellm.example.com/v1` |
| `LITELLM_API_KEY` | The proxy key used as the Bearer token |

Keep both in the deployment's secret store. Neither belongs in the repository,
in an image, or in a committed environment file. Without both variables the
provider is not registered and the service behaves exactly as before.

## Model discovery

At startup the service calls:

```
GET ${LITELLM_BASE_URL}/models
Authorization: Bearer ${LITELLM_API_KEY}
```

Every returned `data[].id` is advertised to the agent model picker as:

```
litellm/<model-id>
```

The router sends `<model-id>` to the proxy's `/chat/completions` endpoint.
Models are read once per process: restart `agent_harness_service` to pick up
models added or removed in LiteLLM. A failed discovery logs a warning and
leaves the built-in catalog in place; it does not prevent the service from
starting.

## Operational notes

- **Model ids:** use the id LiteLLM returns. If a model id itself contains a
  slash, it is kept after the `litellm/` prefix and sent to the proxy verbatim.
- **Agent API keys:** per-agent API keys (BYOK) only support the native
  Anthropic and OpenAI providers. LiteLLM models use the deployment key above.
- **Pricing and quotas:** LiteLLM models are not in `ai_pricing` or the
  provider `MONTHLY_CAPS` table by default. Add pricing rows if AI spend and
  quota accounting must include them; otherwise usage is recorded without a
  priced cost.
- **Capabilities:** context-window and image-input metadata are not known for
  LiteLLM models. The picker treats them as unknown rather than guessing.
- **Health:** the existing provider-account monitor watches Macro's native
  provider accounts. A LiteLLM outage surfaces as failed turns on `litellm/*`
  models; check the proxy's own health and logs.

## Verification

```bash
cargo check -p agent -p agent_inmem -p agent_harness_service
cargo test -p agent_inmem domain::models
```

A deployment check can list the advertised ids from a running harness, or
select a `litellm/<model>` entry in an agent's model picker.
