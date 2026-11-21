/** How a picker orders people by the contact lists they are in: ordered
 * groups of list keys, best first. List keys are opaque to the cache. */
export type ContactListPriority = readonly (readonly string[])[];

/** Personal @mention windows: people the viewer interacted with or invited,
 * then teammates, then people known through a connected inbox, as a tab
 * without the cache lists direct-message partners, then teammates. */
export const MENTION_LIST_PRIORITY: ContactListPriority = [
  ['interacted', 'invited'],
  ['teammates'],
  ['gmail', 'outlook'],
];
