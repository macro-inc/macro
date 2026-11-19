import type { ValidHotkey } from '@core/hotkey/types';
import { describe, expect, it } from 'vitest';
import { buildSidebarLinks, type SidebarItem } from './sidebar';

const linksOnKey = (links: SidebarItem[], key: ValidHotkey) =>
  links
    .filter((link) => [link.hotkey].flat().includes(key))
    .map((link) => link.id);

describe('buildSidebarLinks', () => {
  it('sends g i to Notifications when it is on the rail', () => {
    const links = buildSidebarLinks(
      false,
      false,
      false,
      true,
      false,
      true,
      'off'
    );
    expect(linksOnKey(links, 'i')).toEqual(['notifications']);
    expect(linksOnKey(links, 'h')).toEqual(['home']);
  });

  it('keeps g i on Home without Notifications', () => {
    const links = buildSidebarLinks(
      false,
      false,
      false,
      false,
      false,
      true,
      'off'
    );
    expect(linksOnKey(links, 'i')).toEqual(['home']);
  });

  it('sends g h to New Home beside old Home, and drops g i', () => {
    const links = buildSidebarLinks(
      false,
      false,
      false,
      true,
      false,
      true,
      'both'
    );
    expect(linksOnKey(links, 'h')).toEqual(['new-home']);
    expect(linksOnKey(links, 'i')).toEqual([]);
  });

  it('sends g h to New Home once it replaces Home, and drops g i', () => {
    const links = buildSidebarLinks(
      false,
      false,
      false,
      true,
      false,
      true,
      'new-only'
    );
    expect(linksOnKey(links, 'h')).toEqual(['new-home']);
    expect(linksOnKey(links, 'i')).toEqual([]);
  });

  it('gives every go-to letter one destination, with Sent on g s', () => {
    for (const flag of [false, true]) {
      const links = buildSidebarLinks(
        flag,
        flag,
        flag,
        flag,
        flag,
        flag,
        'off'
      );
      const keys = links.flatMap((link) => [link.hotkey ?? []].flat());
      expect(keys).toEqual([...new Set(keys)]);
      expect(linksOnKey(links, 's')).toEqual(['mail']);
      expect(linksOnKey(links, 't')).toEqual(['tasks']);
    }
  });
});

it('omits CRM navigation and its hotkey for a denied member', () => {
  const denied = buildSidebarLinks(
    false,
    false,
    false,
    true,
    false,
    false,
    'off'
  );
  expect(denied.some((link) => link.id === 'companies')).toBe(false);
  expect(linksOnKey(denied, 'o')).toEqual([]);
  const allowed = buildSidebarLinks(
    false,
    false,
    false,
    true,
    false,
    true,
    'off'
  );
  expect(linksOnKey(allowed, 'o')).toEqual(['companies']);
});
