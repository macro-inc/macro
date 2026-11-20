import {
  groupMenuItems,
  type MenuGroup,
} from '../../../lib/core/menu/group-menu-items';

export type HeaderMenuAction =
  | 'cut'
  | 'copy'
  | 'paste'
  | 'paste-values'
  | 'clear-values'
  | 'insert-before'
  | 'insert-after'
  | 'delete'
  | 'hide'
  | 'unhide'
  | 'resize'
  | 'autofit'
  | 'sort-asc'
  | 'sort-desc';

export function headerMenuEntries(axis: 'row' | 'column') {
  const actions: HeaderMenuAction[] = [
    'copy',
    'cut',
    'paste',
    'paste-values',
    'insert-before',
    'insert-after',
    'clear-values',
    'resize',
    'autofit',
    ...(axis === 'column' ? (['sort-asc', 'sort-desc'] as const) : []),
    'hide',
    'unhide',
    'delete',
  ];
  const groupOf = (action: HeaderMenuAction): MenuGroup => {
    if (action === 'copy') return 'copy';
    if (action === 'hide' || action === 'unhide') return 'state';
    if (action === 'delete') return 'delete';
    return 'modify';
  };
  return groupMenuItems(actions, groupOf).flatMap((section, index) => [
    ...(index ? (['separator'] as const) : []),
    ...section.items.flatMap((action) =>
      action === 'sort-asc' || action === 'insert-before'
        ? (['separator', action] as const)
        : [action]
    ),
  ]);
}
