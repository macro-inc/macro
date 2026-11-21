/** How a picker orders people by the contact lists they are in: ordered
 * groups of list keys, best first. List keys are opaque to the cache. */
export type ContactListPriority = readonly (readonly string[])[];

/** Personal @mention windows: teammates, then people the viewer interacted
 * with or invited, then people known through a connected inbox. */
export const MENTION_LIST_PRIORITY: ContactListPriority = [
  ['teammates'],
  ['interacted', 'invited'],
  ['gmail', 'outlook', 'imap'],
];
