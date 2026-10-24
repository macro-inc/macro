import type { ValidHotkey } from '@core/hotkey/types';
import { describe, expect, it } from 'vitest';
import { buildSidebarLinks, type SidebarItem } from './sidebar';

const linksOnKey = (links: SidebarItem[], key: ValidHotkey) =>
  links
    .filter((link) => [link.hotkey].flat().includes(key))
    .map((link) => link.id);

describe('buildSidebarLinks', () => {
  it('sends g i to Notifications when it is on the rail', () => {
    const links = buildSidebarLinks(false, false, false, false, true);
    expect(linksOnKey(links, 'i')).toEqual(['notifications']);
    expect(linksOnKey(links, 'h')).toEqual(['home']);
  });

  it('keeps g i on Home without Notifications', () => {
    const links = buildSidebarLinks(false, false, false, false, false);
    expect(linksOnKey(links, 'i')).toEqual(['home']);
  });
});
