export const SPLIT_CONTAINER_DATA_ATTRIBUTE = 'data-split-container';
export const SOUP_LIST_CONTAINER_DATA_ATTRIBUTE = 'data-soup-list-container';
export const ENTITY_ID_DATA_ATTRIBUTE = 'data-entity-id';

export const splitContainerAttribute = {
  [SPLIT_CONTAINER_DATA_ATTRIBUTE]: true,
} as const;
export const soupListContainerAttribute = {
  [SOUP_LIST_CONTAINER_DATA_ATTRIBUTE]: true,
} as const;

export function entityIdAttribute(entityId: string) {
  return { [ENTITY_ID_DATA_ATTRIBUTE]: entityId } as const;
}

export const splitContainerSelector = `[${SPLIT_CONTAINER_DATA_ATTRIBUTE}]`;
export const soupListContainerSelector = `[${SOUP_LIST_CONTAINER_DATA_ATTRIBUTE}]`;

export function entityIdSelector(entityId: string): string {
  return `[${ENTITY_ID_DATA_ATTRIBUTE}="${entityId}"]`;
}
