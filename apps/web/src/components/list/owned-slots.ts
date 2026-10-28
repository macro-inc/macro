const slotNameWithPrefix = (prefix: string) => (name: string) =>
  `${prefix}:${name}`;

export const listOwnedSlotName = slotNameWithPrefix('list');
