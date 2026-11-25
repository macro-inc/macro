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
`onScrollStart`, `onNearEdge`, `onWheelNavigate`, `onNavigationCancel`, and `onSettle`.

Controller: `pages`, `pageOrder`, `activePage`, `position`, `targetPosition`,
`origin`, `phase`, `discrete`, `canStep`, `next`, `previous`, `goTo`, `reset`,
`locked`, `setLocked`, `resize`, and `attachViewport`. Page descriptors expose
stable `key`, `position`, and relative `offset`.

- Native touch scrolling owns momentum until settlement. Native `scrollend`
  settles promptly; 350ms of observed positional stillness also recovers missing
  events, including when the browser exposes the API but does not deliver one.
  A no-event release recovers after 150ms only while its position is unchanged;
  silent movement during that window starts the same native-momentum watcher.
- Controlled slides and final alignment take 140ms with the shared Pager ease-out
  curve. Their frame completion owns settlement; delayed scrollend cannot finish
  another controlled slide. Reduced motion is immediate.
- Period buttons ignore an active controlled slide. Repeated idle commands jump
  instantly and report the aggregate after the burst.
- Discrete desktop mode turns horizontal wheel gestures into one step.
- `onSettle` reports total movement after recycling, including zero-move cancellation.
- `onNearEdge` reports the logical position entering view within two slots of an edge,
  from scroll events or the silent-movement watcher. Use it for data-only lookahead;
  it does not recycle slots or write scroll offsets during momentum.
- Lock paging during child drag/resize; unlocking realigns the current page after
  contact ends. Unlock alignment retains its committed target through zero width
  and ignores layout clamping until recovery finishes. It resumes on reveal, after
  contact and momentum end, without cancelling a queued date jump.
  The cancelled contact cannot restart period navigation; a fresh contact can
  supersede recovery normally.
