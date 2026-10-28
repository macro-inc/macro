Split layout should support an arbitrary number of vertical splits.

## Opt-in view restoration

`SplitLayoutProvider` owns a memory-only, account-scoped view-state store.
A view opts in by calling `useViewRestoration()` in its stable route component.
The default key comes from the current router location, with Agents conversations
normalized to `agents`; pass an explicit key to override that grouping.

The hook captures its current location, route state, and entry-state slices in
`useBeforeLeave`. It stages the snapshot with the navigation's `onCommit`
callback, so a refused, cancelled, failed, or superseded navigation cannot replace
the saved snapshot. Solid cleanup only unregisters the hook; it never saves state.

Ordinary rail, Go To, and mobile dock navigation sets `resume: true` on the existing
layout actions. Only opted-in views resume. A mounted view can supply its current
state directly, and the last focused instance wins when several splits show a view.
Explicit links and new-split actions stay fresh. Native dock navigation still
resets the pane stack, and dock Search starts a fresh session. Reload, sign-out,
and account changes retire the saved state. Views still unmount normally.

Views retain local context through `useEntryState` or `registerEntryStateCaptor`.
These slices restore through both pane Back/Forward and opted-in app switches;
route/schema state stays separate. Restores use the existing router, including
leave guards, middleware, URL updates, and single-owner content claims.

Resolve restoration keys and initial entry-state slices from the current router
entry, not the layout mirror: an outlet can mount before the mirror updates.

The remaining notes below describe the original split layout.


SplitLayoutRouter is responsible for handling the routing of the splits.

url schema stays the same `app/<split_type>/<split_id>/<split_type>/<split_id>`


a `split_type` can either be a `BlockName` or the string literal `component`

`components` should get resolved by a `ComponentRegistry`

`resolveComponent` should resolve a component by its name, and parameters

`BlockOrchestrator` owns creating and destroying the blocks themselves.

`Blocks` can exist either mounted to a layout, another block, or completely detached

`LayoutManager` owns the layout state, which is managed through the url

`LayoutManager` must exist within the tree of a SolidRouter, while `BlockOrchestrator` can exist outside of it.

`LayoutManager::insertSplit(splitContent?: SplitContent)` should insert a new split into the layout, and return a `LayoutSplit` object handle to manage the split

Composable utilities should tie them together.

`LayoutManager::getSplit()` should return a `LayoutSplit` object which you can use to navigate the splits back and forth.

Each split should have a `SplitContext` with its own `LayoutSplit` object handle to manaipulate its own split

`LayoutSplit::goBack()` and `LayoutSplit::goForward()` should navigate the split back and forth

`LayoutSplit::replace(splitContent: SplitContent)` should replace the current split content with a new one, this will automatically apply to the splits history

TODO:
- [x] figure out what is wrong with split history. It will occasionally not work as expected
- [x] replace existing usages of blockLayout with the layoutManager
- [x] figure out some clean alternative to a global layout manager. Maybe passing it through context?
- [x] wrap all non block components with a SplitLayout Top Bar tha thas all the navigation buttons
- [x] port over nested block implementation to use block orchestrator
- [x] add a temporary settings menu to the global bottom bar
- [x] disable the right bar for now.
- [x] port over BlockRoute to the new SplitRoute
- [ ] fix instances of stripOtherBlocksFromUrl

Things that might be broken
- command menu will always open things in a new split
- query params are broken
- Browser history changes won't live update
- Right hand side panel has been temporarily removed
- No way to see channel notifications.

TODO AFTER:
- [ ] better resizing for panels, should resize based on the existing ratio
- [ ] need a split dialog (a dialog that is centered on the split)
- [ ] useBeforeLeave won't work as expected going forward, since we use the split layout as the source of truth.
      Lots of places use `isLeavingCurrentBlock` to run some side effects, we need to abstract this under the split
      Might need something like `useBeforeSplitClose` or `useBeforeBlockClose`
