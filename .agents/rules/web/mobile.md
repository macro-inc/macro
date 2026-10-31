---
description: "Mobile UI uses the shared touch helpers, chrome, and sheets."
paths:
  - "apps/web/src/**/*.tsx"
  - "apps/web/src/**/*.css"
  - "apps/web/src/lib/core/mobile/**"
globs: "apps/web/src/**/*.tsx,apps/web/src/**/*.css,apps/web/src/lib/core/mobile/**"
alwaysApply: false
---

# Build mobile UI with the shared touch helpers

The web app is also the iOS and Android apps. Mobile bugs come from hover-only
UI, taps that drop the keyboard, content under chrome or safe areas, and
WebKit quirks that Chrome emulation never shows.

Before building mobile UI, open the app at phone width and study how existing
surfaces solve the same problem (sheets, the dock, header islands, list rows),
read their code, and follow that pattern rather than inventing a new one.

## Detection and input

- `isTouchDevice()` / `touch:` decide input (no hover); `isMobile()` /
  `mobile:` decide phone layout (touch and under 640px). Hide a desktop
  control and show its touch replacement with the same one, or tablets get
  neither. Native checks (`isPlatform` in `@core/util/platform`) are for
  native bridges and platform-specific visual effects, not layout.
- When a surface needs a different phone or touch layout, compose a separate
  mobile view from shared parts (and a shared state primitive) instead of
  branching on `isMobile()` / `isTouchDevice()` throughout one component;
  extract the parts first if needed. The task composer
  (`features/task-composer/views`) is the reference.
- Gate hover and press styles with `not-touch:`; iOS leaves hover stuck.
- No action lives only behind hover. `HoverCard` renders nothing on touch,
  so give it a tap path that opens a sheet, as `UserCardTrigger` does.
- Keep tooltips disabled on touch devices, including focus and controlled-open states.
- Keep `@ui` Button's touch sizing (no `noTouchResize` without cause); rows
  are 44px on touch (`touch:min-h-[44px]`).
- Long-press goes through the `touchHandler` directive. On scrollable rows,
  selecting or dragging starts only after a long press; dedicated reorder
  handles instead drag after a small movement with no hold delay and reserve
  scrolling for the rest of the row. Horizontal swipes ignore the left edge
  (iOS back swipe).
- Keep navigation, filter pills, and create-menu taps silent; keep haptics for
  long press and use `hapticImpact('light')` for valid message/AI sends. Navigation
  acts on click so held or cancelled touches do nothing. `glass` and `island`
  controls and channel inputs get iOS-app-only press animation from
  `installGlassPress`; reuse it and keep Android and web free of the effect.

## Sheets, menus, and dialogs

- Use `@ui` `Dialog` and `ConfirmDialog`; they become drawers on phones.
  Build other sheets from `MobileDrawer` (`components/app/mobile`), never raw
  `@corvu/drawer`, with content in `MobileDrawer.ScrollBody` and height from
  `maxHeight` / `targetHeight`, never hand-set.
- Phone drawers have a handle and no X; drag, backdrop, or Escape dismiss,
  and focus returns to the opener. No submenus at phone width: drill in
  place with a back row.
- Actions that must stay in reach while a sheet scrolls sit in its pinned
  chrome between the handle and `MobileDrawer.ScrollBody`, never in a sticky
  band inside the scroll. A touch popover split exposes that slot as
  `drawerHeader` on its panel context; see `MobileEventForm`. Content that
  grows to fill its sheet (a composer's description) calls `fillDrawer` from
  that context to open at a fixed height; see `MobileTaskComposer`.
- Pick people, projects, tags, or other searchable lists from a touch sheet
  with `PickerSheet` (`components/app/mobile`), not a dropdown: a full-height
  sheet stacked over the current one with Cancel, a title, and Done, and no
  handle or drag. Create the draft or picker session inside it so each opening
  starts fresh, apply it only on Done, let the list fill `PickerSheet.Body`,
  and cancel `pointerdown` and `mousedown` on the rows so the search field
  keeps the keyboard. It hands focus back to the field that had it when it
  opened, so its opener cancels `pointerdown` and `mousedown` too.
  `Property.SheetEditor` (entity and date properties), `InlineTagsSheetPill`,
  and the event composer's guest pill use it. Short lists (status, priority)
  stay dropdowns: on touch, property menus leave focus where it was.
- A backdrop tap only dismisses: `MobileDrawer` swallows the rest of that tap,
  so it never presses what the scrim covered, even when the sheet unmounts as
  it closes (a `<Show>` around it, or `openDialog`). It swallows only a tap
  that really closed the sheet, so an owner that keeps its sheet open while
  another is stacked on it leaves that sheet's controls pressable. Don't add
  per-sheet delays or click guards for it. A drag dismissal the owner refuses
  (to confirm a discard, or while an action is pending) snaps the sheet back
  open.
- A sheet opened from another sheet stacks on it under its own scrim, which
  shares the sheets' layer (as Dialog's does), so the sheet beneath dims with
  the page and only the top sheet's handle stands out. Open it under the
  sheet's owner (in its component tree, or `openDialog` with `owner`, as
  `useAddInboxFlow` does): a dialog mounted elsewhere starts its own dismiss
  stack, so its Cancel, Escape or Back also closes the sheet beneath.
- Overlays are Kobalte or corvu layers or handle Escape: Android Back sends
  Escape to the top layer. Own back stacks use `useAndroidBackNavigation`.
- Persistent prompts (`toast.custom` with `persistent`) go to the prompt
  region (`useKeyedPersistentToasts` does it); a prompt in the transient
  region would cover a sheet's controls.
- Pass a composer typeahead or picker menu's `floatWithSelection` its
  `fullHeight` (content cap plus panel padding) so it picks the side with room
  for its whole list instead of shrinking below the caret when its first
  render is short.

## Keyboard and focus

- Focus inputs on user intent only, never on mount. On touch, Enter in a
  composer inserts a newline; the send button submits.
- iOS raises the keyboard only for a focus inside the tap. A tap that opens a
  composer whose field mounts later calls `triggerFocusInput` in the tap (see
  `raiseKeyboardForNewTaskTitle`), or a create menu item's `raiseKeyboard`;
  popovers and the create menu leave focus with its stand-in.
- UI over an editor must not take focus: cancel `pointerdown` and
  `mousedown` on its root (`keepEditorFocus` in `TouchSelectionToolbar`) or
  use `usePreserveFocusOnButtonTaps`; mark sibling regions
  `data-keep-keyboard`. Dismiss with `useTouchOutsideToDismissKeyboard`.
- Size against the keyboard with `var(--dvh,1dvh)` and
  `var(--virtual-keyboard-height,0px)`, fallback included (Android leaves it
  unset); in JS read `virtualKeyboardVisible()`. Sheets with inputs call
  `scrollToFocusedInput` from `onFocusIn`.
- Never remount a focused editor (keys on content ids, Suspense around it).
  Collapsed inputs match the focused height (`CollapsedInput`), and hidden
  controls use `hidden`, not `opacity-0`, so neighbors don't jump.

## Layout and chrome

- Reserve `--mobile-content-inset-top` (safe area plus any floating split
  header) with `touch:` on every full-frame view, including loading/error states
  and record tabs; phone width alone and `--safe-top` alone do not cover tablets
  or floating navigation. Use `ViewShell.Header` for collection controls; when
  an in-flow header consumes the inset, reset it to `0px` on its content subtree
  so nested lists/editors do not reserve it again. Otherwise pad the scroller
  with the top and bottom content insets so content scrolls under the chrome.
- Safe areas come from the `--safe-*` CSS variables (e.g.
  `bottom-[var(--safe-bottom,0px)]`); `getSafeAreaInset` only when JS needs
  the number. Never measure insets yourself.
- Wrap split-header contributions in `HeaderIsland` (the touch header
  ignores taps outside islands). Bottom chrome goes through `FloatRegion` or
  `FloatRegionOrInline` with `px-(--mobile-chrome-gutter)` and
  `pointer-events-auto`. Style it with `island` / `glass`, size it with the
  px `--mobile-chrome-*` tokens (not rem), and pass Button a `depth`.
- Mark selection with `ink`, never `accent`: a selected pill is `bg-ink
  text-surface`, a selected dock button or drawer row stays at full ink while
  its siblings dim (`text-ink-extra-muted`, `aria-current="page"`). Keep the
  accent for attention — unread dots and filter counts.
- Phones show one pane: open in place or as a front pane, never a new
  split. Desktop-only layouts fall back (board to list) and update the URL.
- Suspense wraps content, never the router or chrome, with `ContentLoading`
  as the fallback; otherwise phones go blank.
- Keep content and actions the same as desktop and change presentation.
  Drop a feature on phones only when it is desk work (API keys).

## Platform pitfalls

- Construct Web Workers on first use, never at module load: eager module
  workers deadlock iOS WKWebView. Open links with `openExternalUrl`.
- Virtual rows reserve media size up front (resizes during iOS momentum
  scroll jump the list; see `ThreadList`); virtual lists use
  `overscroll-none`.

## Verify

- Check at 390px with touch emulation (width alone doesn't set `touch:`) and
  a tablet (touch at desktop width). Check keyboard, safe areas, and native
  menus in the iOS Simulator and tap/focus bugs on a physical iPhone
  (`apps/web/AGENTS.md`); Android per `docs/development/android.md`.

Check: no hover-only actions, the helpers above are used, and the change was
seen at phone width with touch emulation.
