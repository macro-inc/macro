import { sidebarContent } from '@components/app/app-sidebar/sidebar';
import {
  SIDEBAR_NEXT_NAV_ITEMS,
  type SidebarNextNavItem,
} from '@components/app/sidebar-next/nav-items';
import { expect, it } from 'vitest';
import { resolveComponent } from './componentRegistry';

// A split opened from the rail or `g` resolves its view by id before the
// router takes over; an id with no registration throws on that path.
it('registers every view the rail opens', () => {
  const items: SidebarNextNavItem[] = SIDEBAR_NEXT_NAV_ITEMS;
  for (const item of items) {
    const { id } = sidebarContent(item.viewId ?? item.id);
    expect(() => resolveComponent(id), id).not.toThrow();
  }
});

it('registers the native Calendar Settings destination with its own shell', () => {
  expect(resolveComponent('calendar-settings').initialMeta).toMatchObject({
    splitPanelLayout: 'composable',
  });
});
