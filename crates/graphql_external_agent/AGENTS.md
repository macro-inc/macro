# graphql_external_agent

## What it is

Part of agents: the GraphQL adapter for external agents, for two audiences in
one schema. Owners use `GraphqlUser.externalAgents` and the owner mutations;
an agent's runtime, authenticated with its bot token alone, uses the root
`externalAgent` viewer, `replyToExternalAgentEvent`, and
`setExternalAgentTyping`.

## Start here

- `src/context.rs`: request data, and `GraphqlAgentPrincipal`, the bot that
  DSS inserts in place of a user for bot-token requests.
- `src/mutation.rs`: every mutation, owner and agent.
- `src/agent.rs`: the agent's inbox reads.

## Scope

- Owns: GraphQL shapes and error codes for external agents.
- Not here: policy → `crates/external_agents`; schema composition →
  `crates/complete_graph`; authenticating bot tokens → DSS
  `src/api/graphql_soup.rs`.

## Checks

- `cargo test -p graphql_external_agent`
- After shape changes: regenerate `static_assets/schema.graphql` (see
  `docs/guides/add-graphql-field.md`) and run `cargo test -p complete_graph`.

## Gotchas

- Agent fields read `GraphqlAgentPrincipal`; owner fields read the user.
  Neither falls back to the other, so a bot token can never reach user data.

## Related

- Docs: `docs/guides/add-graphql-field.md`, `docs/architecture/external-agents.md`
