# Code Context

## Files Retrieved
1. `apps/web/src/features/activity/my-activity-view.tsx` (lines 1-215) - Current Activity feed UI, data ownership, grouping, pagination, row rendering, and classic split header.
2. `apps/web/src/components/app/split-layout/componentRegistry.tsx` (lines 213-257) - Lazy Activity registration, analytics wrapper, feature-flag redirect behavior, and `activity` component ID.
3. `apps/web/src/features/activity/use-activity-feed-flag.ts` (lines 1-18) - Activity rollout gate used by the registered view.
4. `apps/web/src/lib/queries/activity/graphql/feed.ts` (lines 1-39) - Existing infinite GraphQL query; 50-row pages, cursor pagination, cache-and-network behavior.
5. `apps/web/src/features/experimental-app-layout/experimental-app-sidebar.tsx` (lines 29-93, 113-184) - Experimental sidebar already routes Activity to component ID `activity`; active-state and split-opening behavior need no route changes.
6. `apps/web/src/features/experimental-app-layout/state.ts` (lines 1-25) - Persisted, reactive experiment preference used to branch experimental UI.
7. `apps/web/src/features/next-soup/soup-view/soup-view.tsx` (lines 515-545, 785-814) - Existing desktop-only experimental branching pattern: require experiment enabled, reject touch devices and Inbox, then replace only chrome while retaining data/selection behavior.
8. `apps/web/src/features/experimental-app-layout/experimental-soup-layout.tsx` (lines 161-182, 383-425, 581-914) - Styling reference for title/header gutters, search/control rows, inner sidebars, and responsive list-body alignment.
9. `apps/web/src/routes/Root.tsx` (lines 230-246) - `/activity` already resolves through the shared layout route.
10. `apps/web/src/components/app/Layout.tsx` (lines 482-528) - App-level classic/experimental sidebar selection; Activity content itself is not changed here.

## Key Code

### Existing Activity registration and flag behavior
`apps/web/src/components/app/split-layout/componentRegistry.tsx` (lines 223-257):

```tsx
const MyActivityView = lazy(() =>
  import('@app/features/activity/my-activity-view').then((module) => ({
    default: module.MyActivityView,
  }))
);

function TrackedMyActivityView() {
  usePageViewTracking('activity');
  return <MyActivityView />;
}

function MyActivityViewWrapper() {
  const activityFeedEnabled = useActivityFeedFlag();
  const posthog = usePosthog();
  return (
    <Show
      when={activityFeedEnabled()}
      fallback={
        <Show when={posthog.flagsLoaded()}>
          <RedirectSplit to={{ type: 'component', id: 'inbox' }} />
        </Show>
      }
    >
      <TrackedMyActivityView />
    </Show>
  );
}

registerComponent('activity', withAuth(MyActivityViewWrapper));
```

Keep this wrapper intact. It prevents the query from mounting when the flag is off and preserves bookmarked/restored split recovery.

### Current Activity data flow
`apps/web/src/features/activity/my-activity-view.tsx` (lines 50-102):

```tsx
export function MyActivityView() {
  const feed = createMyActivityQuery({ enabled: () => true });
  const groups = createMemo<FeedGroup[]>(() => {
    // Groups newest-first events using dateBucket(...)
  });

  return (
    <div class="@container/u-list flex size-full flex-col">
      <SplitHeaderLeft>...</SplitHeaderLeft>
      <StaticMarkdownContext>
        <div class="min-h-0 flex-1 overflow-y-auto py-1">
          ...
          <FeedGroups groups={groups()} row={SentenceTimelineRow} />
          ...pagination...
        </div>
      </StaticMarkdownContext>
    </div>
  );
}
```

The query, grouping, entity resolution, row navigation, and pagination are already self-contained. Only chrome/layout needs an experimental branch.

### Existing experiment guard to mirror
`apps/web/src/features/next-soup/soup-view/soup-view.tsx` (lines 515-537):

```tsx
const experimentalView = createMemo(() => {
  if (
    !experimentalAppLayoutEnabled() ||
    isTouchDevice() ||
    contentId === 'inbox'
  ) {
    return undefined;
  }
  // resolve custom experimental view
});
```

Activity should use the same two relevant gates: `experimentalAppLayoutEnabled()` and `!isTouchDevice()`. This preserves classic mobile/touch and classic desktop when the preference is off.

### Existing Activity route
`apps/web/src/features/experimental-app-layout/experimental-app-sidebar.tsx` (lines 53-62):

```tsx
{
  id: 'activity',
  label: 'Activity',
  contentId: 'activity',
  icon: BellIcon,
}
```

No sidebar route or split-registry change is required.

## Architecture

- `/activity` enters the normal layout route and restores/opens split content ID `activity`.
- `componentRegistry.tsx` authenticates, checks the Activity feature flag, records analytics, and lazily mounts `MyActivityView`.
- `MyActivityView` owns the GraphQL infinite query, groups events into date buckets, renders linked timeline rows, and fetches subsequent pages.
- Unlike Soup-backed experimental views, Activity does not pass through `SoupView`, so `ExperimentalSoupLayout` cannot style it automatically.
- The smallest safe design is to branch inside `MyActivityView` after creating the shared query/groups:
  - classic/touch: return the current markup unchanged;
  - experimental desktop: render a new Activity-specific shell using the same feed content.
- Extracting a small shared feed-body component avoids issuing two queries and keeps row behavior, empty/error messaging, grouping, and pagination identical.

Recommended experimental composition:

```tsx
const useExperimentalChrome = () =>
  experimentalAppLayoutEnabled() && !isTouchDevice();

return (
  <Show when={useExperimentalChrome()} fallback={<ClassicActivityFeed ... />}>
    <ExperimentalActivityView ... />
  </Show>
);
```

Suggested experimental shell:
- Root: `@container/experimental-activity flex size-full min-h-0 flex-col bg-panel`.
- Header: large `Activity` title using the same responsive gutters as other experimental views (`px-10`, `@max-[1100px]:px-6`, `@max-[760px]:px-3`, `@max-[480px]:px-2`).
- Body: identical gutter classes to the header so date headers and rows align.
- Feed remains vertically scrollable and retains `StaticMarkdownContext`.
- Keep date grouping and linked sentence timeline rows; optionally add an `experimental` presentation prop to eliminate current `mx-1`/extra row gutters and align the timeline rail with the new body edge.
- No create button or inner sidebar is warranted: Activity has one feed and no alternate navigation or creation action.

## Review Findings

- **Medium:** Activity currently always renders classic `SplitHeaderLeft` chrome (`apps/web/src/features/activity/my-activity-view.tsx:64-71`), so enabling the experimental layout changes its app sidebar but not its content presentation.
- **Low:** Directly wrapping the existing whole view would leave `SplitHeaderLeft` inside the new shell. The implementation should split the current classic header from shared feed content rather than nest both headers.
- **Low:** Activity is not Soup-backed. Adding `activity` to `ExperimentalSoupView` would be the wrong abstraction and would require unavailable Soup context.
- **Low:** Current row wrappers include independent `mx-1` and `px-2` (`apps/web/src/features/activity/my-activity-view.tsx:137-176`), which can recreate the alignment problems recently corrected in experimental Soup lists unless the experimental row path removes the redundant outer gutter.

## Start Here

Open `apps/web/src/features/activity/my-activity-view.tsx` first. It contains the full Activity data and rendering pipeline, and the lowest-risk implementation is a local classic/experimental presentation split around its existing shared feed state.

## Files Likely to Change

- `apps/web/src/features/activity/my-activity-view.tsx` - Add the desktop experiment guard, extract shared feed content, and preserve the exact classic fallback.
- `apps/web/src/features/experimental-app-layout/experimental-activity-view.tsx` - Optional/preferred isolated shell if keeping experiment-specific chrome out of the Activity feature file. It should accept already-computed groups/query state rather than own a second query.

No changes should be needed in:
- `componentRegistry.tsx`;
- `Root.tsx`;
- `experimental-app-sidebar.tsx`;
- the GraphQL query layer.

## Residual Risks

- `isTouchDevice()` is not reactive to switching device modality after mount, matching the existing Soup experiment behavior.
- The Activity flag may be disabled in a local environment, making browser validation redirect to Inbox unless its override is enabled.
- Entity mentions resolve asynchronously; visual validation should include rows with and without a supported linkable entity type.
- Pagination and error/empty states must remain inside the shared feed body so the experimental branch cannot diverge functionally.
