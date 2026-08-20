# Channel Block — Reference Notes for the Agent Block

How `block-channel` / `features/channel` is wired, as a template for giving `block-agent`
real state (live updates, send path, scroll, input). All paths relative to `apps/web/src`
unless absolute. Line numbers are as of commit `254b60f339`.

---

## 1. Block entry & composition

```
features/block-channel/definition.ts          defineBlock({ name:'channel', component: NewChannelBlockAdapter })
  └─ block-channel/component/NewChannelBlockAdapter.tsx   (adapter: tabs, header, persistence, orchestrator)
       └─ features/channel/Channel/Channel.tsx            (the actual channel surface, "pure-ish")
```

### definition.ts (`features/block-channel/definition.ts`)
Trivial: `load` accepts a `dss` source and returns `ok({ id })`. `liveTrackingEnabled: true`.
The agent block's `definition.ts` is already the same shape (with `lazy()` component — keep that).

### The adapter layer (`NewChannelBlockAdapter.tsx`)
Everything "block-shaped" lives here, NOT in Channel.tsx:

| Concern | Where | Mechanism |
|---|---|---|
| Hotkey scope ownership | :194–196 | `useHotkeyDOMScope('channel')` → `blockHotkeyScopeSignal.set(scope)` + `useBlockEntityCommands()`. Channel block doesn't render `BlockContainer`, so it owns the scope itself (comment at :190). |
| Block id | :201 | `useBlockId()` — the channel id. |
| Tabs | :242–265, :449–477 | Local `createSignal<ChannelTabId>` + `ChannelTabProvider` (`Channel/ChannelTabContext.tsx`); `<Switch>` mounts one tab at a time. Switching away from `messages` clears the Channel handle (`setMessagesHandle(undefined)`). |
| Header | `NewTop` :125–187 | Rendered *inside* the block via split-layout portals: `ChannelTopLeft`, `SplitHeaderRight` + `HeaderIsland`, `ChannelTopBarLiveIndicators`. |
| Entry-state persistence | :216–218, :408–427 | `splitPanel.handle.registerEntryStateCaptor(CHANNEL_STATE_ENTRY_KEY, () => snapshot)` — the split layout calls this captor on history navigation; on mount the adapter reads `splitPanel.handle.currentEntryState()?.[key]` and hydrates. `onCleanup(dispose)`. Snapshot = `{ activeTab, messages: ChannelMessagesStateSnapshot }`. |
| Orchestrator methods | :354–380 | `createMethodRegistration(blockHandle, { goToLocationFromParams, goToLatest })`. External navigation (mention click, inbox row) lands here. |
| Handle await | :345–350 | `awaitCondition(() => messagesHandle() !== undefined, 10_000)` — the Messages tab may not have mounted yet; orchestrator methods wait for the child handle via a signal. |
| Target-message resolution | :308–341 | `resolveTargetMessage`: cache-first (`findTopLevelMessageInChannelMessages`, `findThreadIdInChannelMessages`), falls back to `fetchResolvedChannelMessage` roundtrip. |
| Permissions | :430 | Wraps everything in `<EntityPermissionsGate entityType="channel" entityId={channelId}>`. |
| Autofocus | :454 | `autofocus={canAutofocusSplitContent && !navigatedFromJK()}` — split layout + j/k navigation decide, not the component. |

### The child-handle pattern (the key adapter↔component contract)
`Channel` exposes an imperative handle instead of the adapter reaching in:

```ts
// Channel.tsx:151–155
export type ChannelHandle = {
  goToMessage: (messageId: string, replyId?: string) => void;
  goToLatest: () => void;
  getMessagesStateSnapshot: () => ChannelMessagesStateSnapshot | undefined;
};
```

- Channel calls `props.onHandleReady(handle)` once `isChannelReady()` (query fetched +
  navigation ready + initial scroll done) — Channel.tsx:694–711.
- Adapter stores it in a signal (`setMessagesHandle`) so `awaitCondition` can wait on it.
- Adapter also keeps `lastMessagesStateSnapshot` so the captor still answers after the
  Messages tab unmounts (:257, :412–415).

### Props crossing the adapter → Channel boundary (`ChannelProps`, Channel.tsx:133–142)
`channelId`, `targetMessageId?`, `targetMessageReplyId?`, `initialMessagesStateSnapshot?`,
`onHandleReady?`, `autofocus?`. That's it — everything else the Channel derives itself.

---

## 2. Context structure

### Consumed (global, cache-backed — Channel does NOT own these)
| Hook | Source | Backing |
|---|---|---|
| `useChannelName` / `useChannelType` / `useChannelActivity` | `lib/core/context/channels.ts:68–81` | `ChannelsContextProvider` — app-level provider over `useListChannelsQuery` + `useChannelsActivityQuery` (whole channel list, memoized `byId` maps). Per-channel hooks are just memos over it. |
| `useUserId` | `@core/context/user` | app-level |
| `useChannelParticipants` | `features/channel/use-channel-participants.ts` | thin memo over `useChannelParticipantsQuery` → `{ users, ids }` accessors |
| `useSplitPanel` / `useSplitLayout` | `@components/app/split-layout` | split-layout contexts (insets, popoverSplit, openWithSplit) |
| `queryClient` | `@queries/client` | module-global TanStack client — all cache surgery goes through it |

### Created by Channel itself (component-local providers, Channel.tsx:713–984)
```
<StaticMarkdownContext>                    one shared lexical static-markdown editor for all messages
  <SearchHighlightTermsProvider value={findBar.getSearchTermsForMessage}>
    <foldedMessages.Provider>              fold lookup context + Suspense gate (see §4)
      <MaybeMessageActionDrawerManager>    mobile action drawer
        <ChannelDropZone dragState=...>    entity/file drop
```

Rule of thumb the channel follows: **identity/list data is global context; everything
interactive is component-local state created by factories.** The agent block already uses
`StaticMarkdownContext` (Block.tsx:17) — correct instinct.

---

## 3. The `create*` factory pattern (the main thing to copy)

Channel.tsx is ~990 lines but owns almost no logic — it is a *composition root*. Each
factory is a plain function called during setup (component scope, so `onCleanup`/effects
work), taking **accessors + callbacks** in and returning **accessors + methods** out.
Signals are the interface; no factory imports another factory's file — Channel wires them.

| Factory | File | Owns (state) | Takes | Returns | Wired to |
|---|---|---|---|---|---|
| `createTargetMessageController` | `create-target-message-controller.ts:47` | store `{activeTargetMessageId, activeTargetMessageReplyId, loadAroundMessageId, pendingScrollTargetId, pendingTargetReplyId}` + flash timer (1s highlight) | `channelId`, initial target, `messageKeys`, `navigation`, `didInitialScroll` | accessors + `goToMessage/completePendingScroll/clearActiveTarget/reset` | drives `loadAroundMessageId` into the messages query; internal effect executes the scroll via `navigation()` once the key is loaded and initial scroll is done; also swaps the load-around cache back to the default key (`restoreDefaultChannelPaginationAfterTargetLoad`, :214) |
| `useChannelMessagesQuery` + `createMessageIndex` | `@queries/channel/channel-messages.ts:146, :807` | reconciled store `{items, keys, byId}` | query data accessor | oldest-first flat index (pages/items arrive newest-first; dedupe + double reverse); `reconcile()` keeps row identity stable; guards the transient empty-data flash during refetch (:843) | everything renders from `keys`/`byId` |
| `createFoldedMessagesScope` | `create-folded-messages-scope.tsx:40` | delegates to `createFoldedMessages` (§4) | `channelId` | `{ readyLookup, Provider }` — `readyLookup` never suspends; `Provider` = `<AwaitFold/>` (forces Suspense to wait) + context provider | placeholder rows look up their folded body via context |
| `createUnifiedInputManager` | `unified-input-manager.ts:24` | `replyTarget` signal (at most one reply binding channel-wide) | `initialReplyTarget` snapshot, `onReplyThreadReleased` | `replyTarget`, `bindReply(message)`, `closeReply`, `getReplyTargetSnapshot` | bottom input face switching (§6); snapshot goes into entry-state |
| `createThreadManager` | `thread-manager.ts:16` | store of per-thread `ThreadState` (isExpanded, isReplying, replyInputState/El/Handle, focusRequest), lazily created | `initialSnapshot` | `getOrCreateThreadState(threadId)`, `getSnapshot()` | each ThreadList row pulls its state; snapshot → entry-state |
| `createThreadPaginator` | `thread-paginator.ts:41` | per-direction `{pending, is, more}` signals | the infinite query | `isPrepending/isShifting/prependPaginate/shiftPaginate/hasMore*` | `shift` = fetch older (top, virtua `shift` mode), `prepend` = fetch newer (bottom); coalesces re-entrant calls via `pending` do/while loop |
| `createMessageEditor` | `create-message-editor.ts:43` | `editState` signal `{messageId, message, snapshot}` | `channelId`, `participantIds`, `patchMessage` (mutation.mutate), `onEditEnded` | `state/start/update/cancel/save` — `save` diffs content+attachments and no-ops when unchanged | UnifiedEditInput + inline editor + hotkey `e` |
| `createMessageSelection` | `create-message-selection.ts:16` | `selectedId` signal; auto-clears when id leaves `keys` | `keys` accessor | `selectedId/select/clear/selectFirst/selectPrevious/selectNext` | keyboard nav, highlight |
| `createDeleteMessageConfirmation` | `create-delete-message-confirmation.tsx:19` | `pending` signal | `deleteMessage` fn | `{ requestDelete, ConfirmationDialog }` — **returns a component**; mounted once at Channel root (:715) | all delete entry points route through it |
| `createChannelMessageActions` | `create-channel-message-actions.ts:92` | none (pure closure + injectable `effects` for tests) | mutations, `onReply/onEdit/onCreateTask/onChat` callbacks | `(message) => MessageActions` — per-message action set with capability gating (`canEdit/canDelete/...`) | context menus, hotkeys, mobile drawer |
| `createChannelFindBar` | `create-channel-find-bar.ts:46` | wraps `createFindBarController` + search query; active-match memo | `channelId`, `goToMessage`, `clearSelection`, `isMessageLoaded` | FindBarController + `getSearchTermsForMessage` | prefetches next result pages, thread replies, and load-around windows ahead of the cursor |
| `createChannelHotkeys` | `create-channel-hotkeys.ts:47` | two DOM hotkey scopes (message list, input) | selection, navigation, `messageById`, `getMessageActions`, `isEditing`, `isInputEmpty`, callbacks | `{ messageListScopeId, attachMessageListRef, attachInputRef }` — refs attached to DOM in JSX | arrows/enter/e/backspace/escape/shift+g/cmd+f |
| `createChannelKeyboardHandler` | `create-channel-keyboard-handler.ts:47` | pending-reveal signal; **returns void**, pure effect | navigation, `isNearBottom`, `boundMessageId` | — (iOS-only virtual keyboard scroll behavior) | |
| `createStickyScrollEffect` | `sticky-scroll.tsx:29` | none — one `createEffect(on(messages, ...))` | `isNearBottom`, `hasMoreBelow`, `messages`, `scrollToBottom` | void. Scrolls only when a message was *appended at the bottom* AND user was near the true bottom (no more pages below) | the live-follow behavior |
| `createActivityTracker` | `activity-tracker.ts:20` | `newMessagesDismissed` signal; freezes `lastViewedAt`/`openedAt` at first read (so the mark-as-viewed mutation can't hide the "new" divider) | `lastViewedAt`, `userId` | `isNewMessage(message)`, `dismissNewMessages` | new-message divider in list meta |
| `createChannelDragState` | `create-channel-drag-state.ts:27` | plain mutable refs (not signals — never rendered) | `channelId` | drop zone + late-bound setters the input handle fills in `onReady` | `ChannelDropZone` |
| `createInputAttachmentTracker` | `Input/attachment-tracker` (via Channel.tsx:366) | attachment list, persisted | `persistenceKey` | tracker passed into the input | |

**Conventions worth imitating:**
- Options objects with `Accessor<T>` fields; return objects mixing accessors and plain methods.
- Late-bound capabilities as signals: `threadListNavigation`, `threadListScrollState`,
  `channelInputHandle`, `channelInputSnapshot` are all `createSignal<X|undefined>()` filled by
  child `onReady`/`onNavigationReady` callbacks; every factory that needs them takes the
  *accessor* and null-checks (`navigation()?.scrollToBottom()`).
- Factories that need cleanup use `onCleanup` internally (target controller's flash timer,
  keyboard handler's listener) — hence they must be called in component scope.
- Factories that render something return a component (`ConfirmationDialog`, `foldedMessages.Provider`).
- Snapshot/restore is a first-class concern: `getSnapshot()` on any factory whose state
  should survive split-history navigation, and an `initialSnapshot` option to hydrate.

---

## 4. Data layer

### Query (`lib/queries/channel/channel-messages.ts`)
- **Infinite query** keyed by `channelKeys.messages(channelId, loadAroundMessageId)` — the
  load-around id is *part of the key*, so navigating to an old message creates a second
  cache entry (a 50-row window centered on it); `restoreDefaultChannelPaginationAfterTargetLoad`
  later copies that entry over the default key and deletes the variant (create-target-message-controller.ts:214–230).
- Bidirectional cursors: `getNextPageParam` (older) / `getPreviousPageParam` (newer). `staleTime: Infinity` —
  the cache is maintained by hand (mutations + websocket), never by refetch-on-focus.
- `setChannelMessagesData(channelId, updater)` (:194) applies an updater to **every cached
  variant** via key prefix — the core cache-surgery primitive. A big family of pure
  `insert/remove/replace/mark*InChannelMessages(data, ...)` helpers (:255–602) all preserve
  reference equality when nothing changed.
- `createMessageIndex` (:807) — see §3 table.

### Mutations (`lib/queries/channel/message.ts`) — the optimistic send flow
`useSendMessageMutation` (:422):
1. **onMutate**: `registerMessageNonces(optimisticId, ...)` (nonce = the optimisticId);
   `queryClient.cancelQueries(prefix)`; `optimisticInsertChannelMessage` builds a fake
   `ApiChannelMessage` (`id = optimisticId`, `created_at = now`, empty thread) and inserts it
   at the bottom of every cached variant — but **only if the newest page has no
   `previous_cursor`** (i.e. we're actually at the bottom of the conversation, channel-messages.ts:278).
   Returns rollback context.
2. **mutationFn**: `postMessage({ ..., nonce: optimisticId })` — server echoes the nonce in the WS broadcast.
3. **onSuccess**: `replaceOptimisticMessage` swaps `optimisticId → data.id` in place (no refetch);
   refresh soup entity so channel lists re-sort.
4. **onError**: toast + `rollbackInsertChannelMessage` (remove the optimistic row).
5. **onSettled**: `softInvalidateTargetCaches` — `invalidateQueries({ refetchType: 'inactive' })`,
   i.e. mark stale for the *next* mount, don't refetch under the user.

Patch/delete follow the same shape with `createMutationNonce` (`lib/queries/nonce.ts:141`,
prepare-in-onMutate / use-in-mutationFn / cleanup-in-onSettled; 60s TTL). Delete captures a
positional snapshot for rollback; soft-deletes (sets `deleted_at`) when the message has replies.

`reconcile.ts` is the fan-out layer: `resolveMessageTarget` classifies top-level vs thread-reply,
and each `*InTargetCaches` helper applies the change to all three cache families
(paginated channel-messages, thread-replies, by-ids).

### Realtime: socket → cache
- `lib/queries/sync/SyncProvider.tsx` — app-level component using
  `createConnectionWebsocketEffect`, `match(data.type)`:
  - `comms_message` → `handleCommsMessage` (`lib/queries/channel/sync.ts:64`)
  - `agent_session_log` → `handleAgentSessionLog` (`agent-session-stream.ts:220`)
  - `comms_reaction` / `comms_attachment` / `comms_typing` / etc.
- `handleCommsMessage`: `consumeNonce(...)` — if the nonce is ours, the optimistic update
  already applied, so skip the write; otherwise insert/update/delete in cache directly.
  **Always** `softInvalidateTargetCaches` at the end for eventual consistency.
- Adoption: before anything, a payload carrying `agent_session_message` calls
  `adoptAgentSessionPlaceholder` (sync.ts:69–77) so a client-synthesized placeholder row is
  re-keyed to the server row id instead of duplicated.

### The agent-session fold pipeline (already exists — the agent block should reuse it)
- `createFoldedMessages` (`folded-messages.ts:68`): resource + store. Fetches
  `getAgentChannelLog`, opens a fold machine in the worker, then **follows** live WS frames
  through the same machine. Reactivity: a `createStore` keyed
  `bySessionId[sessionId][turn][authorKind] → FoldedMessage`; consumers read through the
  `lookup` closure so only changed rows re-render. Resource resolves once; the store keeps updating.
- `agent-session-stream.ts`: the buffering seam. `beginAgentSessionStream(channelId)`
  **before** the fetch, buffer frames, `followAgentSession` aligns buffer against snapshot
  (`dropOverlap`, :328 — longest buffered-prefix that is a suffix of the fetched log), one
  machine per session shared across split views, refcounted release.
  Also `subscribeAgentSessionLog(sessionId, sink)` (:90) for raw-frame consumers.
- `agent-session-placeholders.ts`: synthesizes a placeholder comms row when the fold derives
  a new message live (`ensureAgentSessionPlaceholder`) and re-keys it when the real row
  arrives (`adoptAgentSessionPlaceholder`). `rememberSessionBot` records sender identity.

---

## 5. Scroll & list (summary)

- **Virtualization**: `virtua/solid` (`Virtualizer` in `Channel/ThreadList.tsx:712`), not a
  hand-rolled list. `itemSize={96}` estimate, `bufferSize={500}`, `shift` prop flips during
  top-pagination so existing items keep their offsets, `keepMounted` pins the target thread's
  row during nested navigation, `cache={snapshot.virtualCache}` restores measured sizes.
- **ThreadList contract**: renders from `keys: Accessor<string[]>` + row render prop; emits
  `onNavigationReady(ThreadListNavigation)` (scrollTo/scrollToId/scrollToBottom/scrollToElementInItem/markUserIntent, :38–61)
  and `onScrollStateChange(ThreadListScrollState)` ({didInitialScroll, isNearBottom, distanceFromTop/Bottom,...}, :63–70).
- **Initial scroll** is a small state machine: preposition to bottom before measurement
  (:538), retry via `onScrollEnd` (:553), RAF fallbacks for "nothing moved". Everything else
  (target scrolls, pagination) is gated on `didInitialScroll`.
- **pinToBottom** (:328): after scroll-to-bottom, re-pin every frame for 1s + ResizeObserver,
  aborted by wheel-up/touch-drag — absorbs late-settling content (images, growing agent output).
  **This is the piece a streaming agent transcript wants most.**
- **Pagination triggers**: `onScrollNearTop/Bottom` fire only with `scrollIntent.isUserInteracting()`
  (:662) so virtualizer-resize scrolls can't fetch pages.
- **Sticky scroll**: `createStickyScrollEffect` (§3) — follow only if appended-at-bottom && near true bottom.
- **Scroll snapshots**: `onScrollSnapshotChange` emits `{scrollOffset, virtualCache, isNearBottom}`
  on every scroll; Channel keeps the latest in a signal; entry-state captor persists it; on
  restore, `isNearBottom` snapshots collapse to "scroll to bottom" (ThreadList.tsx:520–529).
- **Target navigation**: adapter resolves id → Channel `goToMessage` → controller sets
  `loadAroundMessageId` (new query window) + pending scroll ids → effect scrolls when key
  present → row calls `positionTarget`/`onTargetMessageScrolled` to finish → 1s flash then clear.
- `ScrollToBottomOverlay` reads `threadListScrollState`; `handleScrollToBottom` (Channel.tsx:545)
  resets the query to the default bottom window if `hasPreviousPage` (mid-history slice).

---

## 6. Input wiring

- Component stack: `TaskModeChannelInput` (message face + task composer morph,
  `Input/TaskModeChannelInput.tsx`) → `ChannelInput` (`Input/ChannelInput.tsx`, lexical
  markdown editor + mentions tracker + attachment tracker + typing tracker + hotkeys) →
  `Input` primitives.
- **Contract**: `InputSnapshot = { value, mentions, attachments }` (`Input/types.ts:52`);
  `InputHandle = { clear, focus, send, attachFiles, restoreSnapshot, insertEntityMention?, ... }` (:97).
  Channel stores both `onChange`-mirrored snapshot and `onReady` handle in signals (Channel.tsx:204–207).
- **Send** (Channel.tsx:623–648): `buildPostMessageSendPayload({ snapshot, participantIds })`
  (`Input/message-payload.ts:96`) expands mentions (`@here` fan-out, bot re-tagging) and maps
  attachments; then `sendMessageMutation.mutate({ channelID, senderId, optimisticId: crypto.randomUUID(), ...payload }, { onError })`.
  - **Restore-on-error**: the input cleared itself on send; `onError` restores the failed
    snapshot via `handle.restoreSnapshot(snapshot)` — but only if the user hasn't typed new
    sendable content meanwhile (`hasSendableInputContent(current)` check, :643).
- **Persistence**: localStorage-backed draft via `persistenceKey={makeInputValuePersistenceKey({ channelId })}`
  (`Input/utils/persistence.ts` — versioned keys `input-value-channel:<id>[-thread:<id>]`);
  separate keys for attachment tracker, task draft, task mode.
- **Typing indicators**: `ChannelInput` runs `createTypingTracker` (debounced start/stop)
  calling `onStartTyping/onStopTyping` props → `usePostTypingUpdateMutation` (Channel.tsx:961–972).
  Inbound: `comms_typing` WS events feed a module-level signal store (`@queries/channel/typing.ts`), 8s timeout.
- **Input face switching** (Channel.tsx:873–975): `<Switch>` over unified-input mode —
  editing face (`UnifiedEditInput`) > reply face (`UnifiedReplyInput`) > default composer.
  The bottom bar is one surface whose *content* rebinds; state for each face lives in
  messageEditor / unifiedInput / threadManager, not in the input.

---

## 7. Synthesis: what the agent block should take (and skip)

Current agent block (`features/block-agent/`): one-shot `useAgentSessionBlockQuery`
(`data/queries.ts:23` — fetch session + log, `foldSession` once, frozen), plain `<For>` over
messages in a `Scroll` (component/Block.tsx), `AgentInput` with an unwired `onSend`.

### Copy directly

1. **Adapter / component split.** Keep `Block.tsx` as the adapter (header, entry-state
   captor, orchestrator method registration if deep links matter, hotkey scope) and grow an
   `AgentSession.tsx` composition root that takes `{ sessionId, onHandleReady?, initialStateSnapshot?, autofocus? }`
   and exposes a small handle (`goToLatest`, `getStateSnapshot`, maybe `goToTurn`).
2. **The factory decomposition.** Build the stateful surface as `create*` factories with
   accessor-in/accessor-out interfaces, composed in the root:
   - `createAgentSessionFeed` — the analog of `createFoldedMessages` + `createMessageIndex`:
     resource that fetches the log, opens the fold machine, follows live frames, and exposes a
     reconciled *ordered* store of folded messages (the block needs an ordered list, not the
     channel's `(sessionId, turn, author)` lookup — that shape exists in
     `agent-session-stream.ts`'s sink; keep `reconcile()` so streaming appends don't remount rows).
     Reuse `beginAgentSessionStream`/`followAgentSession` (or `subscribeAgentSessionLog`) —
     the buffering seam and one-machine-per-session refcounting are already solved there;
     do NOT refetch-per-frame.
   - `createSessionStatusController` — session status / turn-in-flight / streaming signals
     (derive from the feed's frames; this is our analog of `threadListScrollState` + typing).
   - `createPermissionPrompts` — pending permission requests as a store keyed by request id,
     with `respond(id, outcome)`; model it on `createDeleteMessageConfirmation` (a factory that
     owns pending state *and* returns the UI component) if prompts render as a dialog, or on
     `threadManager` if they render inline per-message.
   - `createComposerController` — the busy/enabled state machine: analog of
     `channelInputSnapshot`/`channelInputHandle` signals + `onSend` in Channel.tsx:623. Own
     `isSending`/`isTurnRunning`, gate `onSend`, and implement **restore-on-error** exactly as
     Channel does (restore snapshot only if input is still empty).
3. **Late-bound handles as signals** for anything the child publishes upward (input handle,
   scroll navigation), with `awaitCondition` in the adapter if orchestrator methods need them.
4. **Optimistic send with nonce-style dedup.** When sending a prompt: append an optimistic
   user-turn row to the feed store immediately, key it by a client id, and adopt/replace when
   the corresponding frame (or server ack) arrives — the exact pattern of
   `optimisticInsertChannelMessage` + `adoptAgentSessionPlaceholder`. The channel's prompt-echo
   problem (`hide-duplicate-prompts.ts`, flagged as a stopgap in Channel.tsx:241–250) is the
   cautionary tale: decide the dedup key (client nonce in the frame?) up front.
5. **Scroll**: at minimum `createStickyScrollEffect`'s exact rule (follow only when appended
   at bottom && near bottom) + a `pinToBottom`-style settle loop, since agent output grows
   after append. If transcripts get long, adopt `ThreadList` itself — it's channel-flavored but
   its props are generic (`keys`, render prop, navigation/scroll-state callbacks); virtua is
   the right tool for a multi-thousand-row session. Persist `{scrollOffset, virtualCache, isNearBottom}`
   in the entry-state captor like the adapter does.
6. **Entry-state captor** (`splitPanel.handle.registerEntryStateCaptor`) for scroll position +
   composer-adjacent state so split history restore doesn't reset the view.
7. **Input**: reuse `ChannelInput` (not `TaskModeChannelInput`) or keep `AgentInput` but adopt
   the `InputSnapshot`/`InputHandle` contract, `persistenceKey` draft persistence
   (`makeInputValuePersistenceKey`-style, keyed by session id), and the send/restore flow.
8. **WS routing**: nothing new needed — `SyncProvider` already routes `agent_session_log`
   frames; subscribe through `agent-session-stream.ts` rather than adding a new socket path.

### Do NOT copy

- **Threads** — thread-manager, thread-paginator's dual direction, thread previews, reply
  inputs, `UnifiedReplyInput`/`UnifiedEditInput` and the whole unified-input-mode face
  switching. Agent sessions are linear.
- **Reactions, message editing, message deletion** — and with them most of
  `create-channel-message-actions` (a slim per-message actions factory for copy-text/copy-link
  is still worth the shape).
- **The multi-variant load-around query machinery** (`loadAroundMessageId` in the query key,
  `restoreDefaultChannelPaginationAfterTargetLoad`, `clearStaleRestoredChannelData`) — the
  session log is fetched whole and folded; there is no cursor pagination to windows. If logs
  ever need windowing, revisit; don't pre-build it.
- **Nonce infrastructure in full** — the channel needs it because every mutation is echoed on
  a shared multi-user socket. A session block likely needs one dedup point (prompt echo), not
  the whole `createMutationNonce` family.
- **Find bar, typing indicators, drag/drop entity mentions, task mode, calls, activity
  tracking / new-message dividers, mobile swipe-to-reply** — channel-specific surface area.
- **`hide-duplicate-prompts`** — explicitly a stopgap; solve prompt identity properly instead.

### Where our extra state slots in (channel-analog map)

| Agent block concern | Channel analog |
|---|---|
| session status / turn running | `threadListScrollState` + typing indicators (derived signal fed by a stream) |
| streaming fold | `createFoldedMessagesScope` + `createFoldedMessages` store (reuse, reshape to ordered list) |
| permission prompts | `createDeleteMessageConfirmation` (pending store + returned dialog component) |
| composer busy state | `channelInputSnapshot`/`channelInputHandle` signals + `onSend` gating (Channel.tsx:204–207, 623) |
| optimistic prompt row | `optimisticInsertChannelMessage` + placeholder adopt (`agent-session-placeholders.ts`) |
| live follow scroll | `createStickyScrollEffect` + `pinToBottom` |
| split restore | entry-state captor + `getStateSnapshot` handle method |
