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
  native bridges, not layout.
- Gate hover and press styles with `not-touch:`; iOS leaves hover stuck.
- No action lives only behind hover. `HoverCard` renders nothing on touch,
  so give it a tap path that opens a sheet, as `UserCardTrigger` does.
- Keep `@ui` Button's touch sizing (no `noTouchResize` without cause); rows
  are 44px on touch (`touch:min-h-[44px]`).
- Long-press goes through the `touchHandler` directive. A touch drag scrolls:
  selecting or dragging starts only after a long press, and horizontal
  swipes ignore the left edge (iOS back swipe).
- Primary nav fires `hapticImpact('light')` on pointer down and acts on
  click, so a held or cancelled touch does nothing. `glass` and `island`
  controls get press animation from `installGlassPress`; add none.

## Sheets, menus, and dialogs

- Use `@ui` `Dialog` and `ConfirmDialog`; they become drawers on phones.
  Build other sheets from `MobileDrawer` (`components/app/mobile`), never raw
  `@corvu/drawer`, with content in `MobileDrawer.ScrollBody` and height from
  `maxHeight` / `targetHeight`, never hand-set.
- Phone drawers have a handle and no X; drag, backdrop, or Escape dismiss,
  and focus returns to the opener. No submenus at phone width: drill in
  place with a back row.
- Overlays are Kobalte or corvu layers or handle Escape: Android Back sends
  Escape to the top layer. Own back stacks use `useAndroidBackNavigation`.

## Keyboard and focus

- Focus inputs on user intent only, never on mount. On touch, Enter in a
  composer inserts a newline; the send button submits.
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

- Content scrolls under the floating chrome: pad the scroller with
  `mobile:pt-(--mobile-content-inset-top)` and
  `mobile:pb-(--mobile-content-inset-bottom)`, never a spacer.
- Safe areas come from the `--safe-*` CSS variables (e.g.
  `bottom-[var(--safe-bottom,0px)]`); `getSafeAreaInset` only when JS needs
  the number. Never measure insets yourself.
- Wrap split-header contributions in `HeaderIsland` (the touch header
  ignores taps outside islands). Bottom chrome goes through `FloatRegion` or
  `FloatRegionOrInline` with `px-(--mobile-chrome-gutter)` and
  `pointer-events-auto`. Style it with `island` / `glass`, size it with the
  px `--mobile-chrome-*` tokens (not rem), and pass Button a `depth`.
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
