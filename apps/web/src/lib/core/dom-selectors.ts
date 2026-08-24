export const SPLIT_CONTAINER_DATA_ATTRIBUTE = 'data-split-container';
export const SOUP_LIST_CONTAINER_DATA_ATTRIBUTE = 'data-soup-list-container';
export const ENTITY_ID_DATA_ATTRIBUTE = 'data-entity-id';
/**
 * Marks a hotkey-neutral region: chrome that lives outside every split (the
 * sidebar, the dock) where taking focus should NOT change the active hotkey
 * scope. Without it, focusing anything outside a DOM scope activates the
 * 'global' scope, muting every split/block command until the user clicks back
 * into a split. Overlays (dialogs, menus) must NOT be marked neutral — their
 * fall-through to 'global' is what mutes app hotkeys beneath them.
 */
export const HOTKEY_SCOPE_NEUTRAL_DATA_ATTRIBUTE = 'data-hotkey-scope-neutral';

export const splitContainerAttribute = {
  [SPLIT_CONTAINER_DATA_ATTRIBUTE]: true,
} as const;
export const soupListContainerAttribute = {
  [SOUP_LIST_CONTAINER_DATA_ATTRIBUTE]: true,
} as const;

export function entityIdAttribute(entityId: string) {
  return { [ENTITY_ID_DATA_ATTRIBUTE]: entityId } as const;
}

export const hotkeyScopeNeutralAttribute = {
  [HOTKEY_SCOPE_NEUTRAL_DATA_ATTRIBUTE]: true,
} as const;

export const splitContainerSelector = `[${SPLIT_CONTAINER_DATA_ATTRIBUTE}]`;
export const hotkeyScopeNeutralSelector = `[${HOTKEY_SCOPE_NEUTRAL_DATA_ATTRIBUTE}]`;
export const soupListContainerSelector = `[${SOUP_LIST_CONTAINER_DATA_ATTRIBUTE}]`;

export function entityIdSelector(entityId: string): string {
  return `[${ENTITY_ID_DATA_ATTRIBUTE}="${entityId}"]`;
}
