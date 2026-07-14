# Seed CLI

Used to populate your local environment with sample data.

Please ensure you have read [RUNNING\_LOCALLY](../../docs/RUNNING_LOCALLY.md) and
have your local environment setup.

## Usage
You can explore the CLI and it's usage with `just seed help`. All commands can 
be run through the `just seed` base command.

## Scenarios

A scenario file describes a complete world — users, teams, channels, and
entities (documents, projects, chats, calls, emails, messages) with the access
edges between them — so varied permission patterns are testable locally. See
`seed/scenarios/team-perms.json` for the reference example.

```bash
# From the repository root (postgres + localstack must be up):
just seed-scenario apply --file seed/scenarios/team-perms.json
just seed-scenario matrix --file seed/scenarios/team-perms.json
just seed-scenario reset --file seed/scenarios/team-perms.json   # or --all
```

- `apply` deletes the scenario's own rows first and re-seeds, so it always
  converges on the config. Every seeded id is derived from
  `(scenario, kind, key)` and starts with the `5eed` marker.
- `matrix` computes the expected access level for every (user, entity) pair
  from the config and verifies it against the live database using the real
  `entity_access` service; it exits non-zero on any mismatch.
- `reset` deletes exactly the rows carrying the scenario's id marker.
- With `run_local`'s passwordless FusionAuth, every seeded user can log in
  immediately using their configured email.
