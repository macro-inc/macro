import { sidebarContent } from '@components/app/app-sidebar/sidebar';
import { SIDEBAR_NEXT_NAV_ITEMS } from '@components/app/sidebar-next/nav-items';
import { expect, it } from 'vitest';
import { resolveComponent } from './componentRegistry';

// A split opened from the rail or `g` resolves its view by id before the
// router takes over; an id with no registration throws on that path.
it('registers every view the rail opens', () => {
  for (const item of SIDEBAR_NEXT_NAV_ITEMS) {
    const { id } = sidebarContent(item.id);
    expect(() => resolveComponent(id), id).not.toThrow();
  }
});

it('opens a restored New Home split', () => {
  expect(() => resolveComponent('new-home')).not.toThrow();
});
