# Service storage GraphQL operations

## Scope

Authored operations live in this directory; `generated/graphql.ts` contains generated types and documents.

## Task dependencies

- Keep `TaskDependencyStateFields` flat and preserve canonical `GraphqlTaskDependencyState` task IDs.
- Select one-hop `dependentTasks` on `GraphqlSoupDocument`, not on dependency states; only `RepairTaskDependencies` currently needs this edge.
- Keep operations within the schema depth ceiling of 32; the authored-operation audit found 139 operations with maximum depth 10.

## Checks

- Regenerate SDL with `cargo run -p complete_graph --bin graphql_schema -- static_assets/schema.graphql` from the repository root.
- Regenerate types with `bunx graphql-codegen --config codegen.ts` from `apps/web`.
- Run `bun run type-check` from `apps/web`.
