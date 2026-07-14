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
  can log in through the real passwordless flow — grab the one-time code with
  `just code <email>` (it reads mailpit). If FusionAuth is unreachable, apply
  seeds database rows only and says so.
- To drive several personas at once in one browser window, open the links
  apply prints (`http://alice.localhost:3000/app/login?email=…`) as plain
  tabs. Hostnames get separate cookie jars (ports don't), the app follows the
  page hostname to the backend proxy, and locally the login completes itself
  (the local backend returns the one-time code and dev builds auto-submit
  it) — so each link logs its persona straight in, one live session per tab
  against the same stack. `just code <email>` still prints codes from mailpit
  for manual logins.
