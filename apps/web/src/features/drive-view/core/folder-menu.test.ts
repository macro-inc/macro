import { expect, it } from 'vitest';
import type { MenuGroup } from '../../../lib/core/menu/group-menu-items';
import { type FolderMenuAction, folderMenuGroups } from './folder-menu';

it('orders all available folder actions into semantic sections', () => {
  const items: { id: FolderMenuAction; group: MenuGroup }[] = [
    { id: 'delete', group: 'delete' },
    { id: 'move', group: 'modify' },
    { id: 'copy-id', group: 'copy' },
    { id: 'mute', group: 'state' },
    { id: 'duplicate', group: 'modify' },
    { id: 'favorite', group: 'most-used' },
    { id: 'rename', group: 'modify' },
    { id: 'copy-link', group: 'copy' },
    { id: 'share', group: 'most-used' },
  ];

  expect(
    folderMenuGroups(items).map((section) => ({
      id: section.id,
      actions: section.items.map((item) => item.id),
    }))
  ).toEqual([
    { id: 'most-used', actions: ['share', 'favorite'] },
    { id: 'copy', actions: ['copy-link', 'copy-id'] },
    { id: 'modify', actions: ['rename', 'duplicate', 'move'] },
    { id: 'state', actions: ['mute'] },
    { id: 'delete', actions: ['delete'] },
  ]);
  expect(items[0].id).toBe('delete');
});

it('only groups available actions for read-only folders', () => {
  const items: { id: FolderMenuAction; group: MenuGroup }[] = [
    { id: 'copy-id', group: 'copy' },
    { id: 'favorite', group: 'most-used' },
    { id: 'copy-link', group: 'copy' },
    { id: 'share', group: 'most-used' },
    { id: 'mute', group: 'state' },
  ];

  expect(
    folderMenuGroups(items).map((section) =>
      section.items.map((item) => item.id)
    )
  ).toEqual([['share', 'favorite'], ['copy-link', 'copy-id'], ['mute']]);
  expect(
    folderMenuGroups(items.slice(0, -1)).map((section) => section.id)
  ).toEqual(['most-used', 'copy']);
});

it('returns no sections for empty availability', () => {
  expect(folderMenuGroups([])).toEqual([]);
});

it('preserves descriptor, content, and handler identities while ordering', () => {
  const handler = () => {};
  const content = { onClick: handler };
  const share = { id: 'share' as const, group: 'most-used' as const, content };
  const favorite = {
    id: 'favorite' as const,
    group: 'most-used' as const,
    content: { onClick: () => {} },
  };
  const items = [favorite, share];
  const sections = folderMenuGroups(items);

  expect(sections[0].items[0]).toBe(share);
  expect(sections[0].items[1]).toBe(favorite);
  expect(sections[0].items[0].content).toBe(content);
  expect(sections[0].items[0].content.onClick).toBe(handler);
  expect(items[0]).toBe(favorite);
});
