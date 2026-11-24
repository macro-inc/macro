# SnapPager

A stable page ring over a native horizontal scroller.

```tsx
import { For } from 'solid-js';
import { createSnapPager, SnapPager } from '@ui/components/SnapPager/SnapPager';

const pager = createSnapPager({ onSettle: (moved) => navigate(moved) });

<SnapPager.Root controller={pager}>
  <SnapPager.Viewport>
    <For each={pager.pages()}>
      {(page) => <SnapPager.Page page={page}>{renderPage(page)}</SnapPager.Page>}
    </For>
  </SnapPager.Viewport>
</SnapPager.Root>
```

## Contract

Options: `pageCount` (odd, at least three; defaults to five), `discrete`,
`onScrollStart`, `onWheelNavigate`, `onNavigationCancel`, and `onSettle`.

Controller: `pages`, `pageOrder`, `activePage`, `position`, `targetPosition`,
`origin`, `phase`, `discrete`, `canStep`, `next`, `previous`, `goTo`, `reset`,
`locked`, `setLocked`, `resize`, and `attachViewport`. Page descriptors expose
stable `key`, `position`, and relative `offset`.

- Native touch scrolling owns momentum until settlement; discrete desktop mode
  turns horizontal wheel gestures into one step and ignores active-animation presses.
- Repeated idle commands settle as an aggregate; `onSettle` reports the total
  movement after recycling, including cancelled gestures with zero movement.
- Lock paging during child drag/resize; unlocking realigns the current page.
