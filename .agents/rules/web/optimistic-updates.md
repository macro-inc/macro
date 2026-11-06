---
description: "Optimistic updates go through the normalized cache's durable mutation queue, never a feature-local helper."
paths:
  - "apps/web/src/**"
globs: "apps/web/src/**"
alwaysApply: false
---

# Make optimistic updates through the normalized cache mutation queue

Feature-local optimism (an `onMutate` snapshot, an override signal, a
`setQueryData` patch with a hand-written rollback) shows one value in the view
that wrote it and another everywhere else, is lost on reload, and races
refetches and later edits. The GraphQL normalized cache already persists, orders,
retries and rolls back optimistic writes, and every live reader sees the same
value.

- **FE-70** Predict a GraphQL mutation with an `optimisticResolver` in
  `src/lib/queries/optimistic-resolvers.ts` (field values; a `SoupUpdated` or
  `GraphqlCacheDeletion` effect re-filters Soup lists), or with
  `executeOptimisticMutation` link `updates` (list membership). Declare the
  strategy in `src/lib/queries/mutation-coverage.test.ts`; see
  [the cache plan](../../../apps/web/docs/graphql-normalized-cache-plan.md#adoption-and-mutation-coverage).
  Enforced by ast-grep `ts-optimistic-through-mutation-queue` +
  `tsx-optimistic-through-mutation-queue`, warning.
- When the cache can't express the update, add the generic capability to
  `src/lib/graphql-cache` with tests, then use it. Don't write a one-off.
- When the write is REST, add its GraphQL mutation before adding optimism, or
  leave the write authoritative. Don't add new `onMutate` patches. REST
  optimism kept beside a GraphQL path behind `enableGraphqlSoup` is deleted with
  that flag, not extended.
- Documented exceptions keep their own optimistic state:
  - Email sends: reservations, leases and cancellation stay in the email
    journal; the queue holds draft autosaves only.
  - Collaborative content in Loro (documents, canvases, collab surfaces).
  - Realtime echo reconciliation (message nonces, streamed chat and agent
    session folds).
  - Local-only UI state (drafts, drag placements, held rows) and call media
    state (LiveKit join and devices).

Check: a new optimistic update is an `optimisticResolver` or
`executeOptimisticMutation` call, or sits in a listed exception; the ast-grep
rule reports nothing new on changed lines.
