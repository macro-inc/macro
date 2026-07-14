# Seed CLI

Used to populate your local environment with sample data.

Please ensure you have read [RUNNING\_LOCALLY](../../docs/RUNNING_LOCALLY.md) and
have your local environment setup.

## Usage
You can explore the CLI and it's usage with `just seed help`. All commands can 
be run through the `just seed` base command.

## Scenarios

A scenario file describes a complete world — users, teams, channels, and
entities (documents, tasks, projects, chats, calls, emails, messages) with the
access edges between them — so varied permission patterns are testable
locally. Tasks are markdown documents with the task subtype plus status and
assignee properties (and an optional share-with-team grant). See
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
- `reset` deletes exactly the rows carrying the scenario's id marker, plus
  (with `--file`) the scenario's user accounts by email. `reset --all` cannot
  know emails, so accounts created through the signup webhook survive it.
- `apply` creates each user's FusionAuth account first (the signup webhook
  writes the base rows, which the seeder then adopts), so every seeded user
  can log in through the real passwordless flow — the one-time codes land in
  mailpit (http://localhost:8025). If FusionAuth is unreachable, apply seeds
  database rows only and says so.
