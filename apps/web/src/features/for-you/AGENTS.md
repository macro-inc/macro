# For you

A desktop feed combining important work, agent ideas, updates, and items to revisit.
It lives at `/app/for-you`, below Home in the outer sidebar.

## Boundaries

- `enable-for-you` gates the desktop route and every navigation entry before mounting the live source; wait for flag loading before redirecting disabled deep links to Home. Local HMR defaults on; deployed environments use PostHog.
- `queries/feed-source.ts` uses the authenticated AI projection service; production never imports test items or supplies placeholder recommendations. While generation is pending it reads status every ten seconds for at most ninety seconds, so a missed gateway update cannot leave the feed waiting indefinitely.
- `core/feed.ts` owns the generated schema and read-only research prompt. Suggestions for agents, databases, and routines must be grounded in inspected workspace context.
- Write feed titles and summaries in brief, everyday language: name the concrete work, keep only essential context, and put detailed execution steps in the action prompt.
- Proactive ideas infer opportunities from the user's goals rather than prescribe fixed use cases. Prefer researched, maintained systems and focused channel participation; consolidate duplicates and notify only for meaningful changes or decisions.
- Save money and Make money filter financial benefit tags on generated ideas, not separate feeds. Ideas may match both; All and Ideas show each once. Cached items without tags default to neither until regeneration.
- Projection keys hash the account, full prompt, model, and output schema so other accounts or older open tabs cannot revise the active projection definition.
- `queries/preferences.ts` scopes preferences and dismissals to the account. The route remounts the feed on account changes.
- Persist only customized prompts; saving dismissals must not pin a translated default. Keep the flagged Home calendar lazily loaded and wait for the flag before initializing its sidebar preference.
- `actions.ts` opens the real agent composer with the suggested instructions unsent, or navigates to the actual source entity. Dismiss only hides a recommendation; it never completes or changes a source task.
- `context/feed-source.ts` is the injected contract used by state and views. Test data lives only in `tests/`.

## Checks

- `bun --bun ../../node_modules/vitest/vitest.mjs run src/features/for-you` from `apps/web`.
- `bun --bun ../../node_modules/@playwright/test/cli.js test --config src/features/for-you/browser-test/playwright.config.ts` from `apps/web`.
- Verify live generation, source navigation, and the prefilled agent composer from the real sidebar destination. Report environment failures separately from fixture results.
