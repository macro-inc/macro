# SnapPager

Seven persistent calendar slots over a 2,001-position native horizontal snap track.

```tsx
import { For } from 'solid-js';
import { createSnapPager, SnapPager } from '@ui/components/SnapPager/SnapPager';

const pager = createSnapPager();

<SnapPager.Root controller={pager}>
  <SnapPager.Viewport>
    <For each={pager.pages()}>
      {(page) => <SnapPager.Page page={page}>{renderPage(page.position())}</SnapPager.Page>}
    </For>
  </SnapPager.Viewport>
</SnapPager.Root>
```

## Contract

Options: `onNavigationCancel` and `onSettle`.

Controller: `pages`, `activePage`, `position`, `fractionalPosition`,
`targetPosition`, `phase`, `nativeScrolling`, `canStep`, `next`, `previous`,
`goTo`, `reset`, `locked`, `setLocked`, `resize`, and `attachViewport`.
Page descriptors expose a stable `key` and a changing logical `position`.
`trackOrigin` places slots on the physical track.

- Native touch and desktop trackpad gestures use the same snap track. Stationary
  snap markers retain their DOM identity while the seven mounted slots are
  reassigned on every scroll or frame sample, including during momentum.
- `fractionalPosition` follows the viewport continuously; `position` rounds to
  the nearest page. Assign content from `page.position()` without waiting for
  settlement. `nativeScrolling()` stays true until a native gesture is idle.
- Buttons and keyboard use `next`, `previous`, or relative `goTo`. The first
  command scrolls smoothly; rapid commands advance immediately. Commands during
  native scrolling wait until native motion ends. `targetPosition` includes them.
- Native motion never writes `scrollLeft`; idle track-boundary recentering,
  programmatic navigation, resize, and reset own physical offset changes.
- `onSettle` reports the distance since the last settled position. A
  fresh contact or rising wheel impulse calls `onNavigationCancel`, including
  when only the caller has a deferred date request. Settlement callbacks can
  replace or reset navigation; stale continuations do not run afterward.
- Locking disables paging. Unlocking realigns after native motion ends.
- The fixed snap markers add 2,001 lightweight DOM nodes. Browser layout and
  paint costs and caller-owned calendar retarget costs need separate measurement.
