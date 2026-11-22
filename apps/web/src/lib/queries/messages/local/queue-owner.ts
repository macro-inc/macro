/**
 * Whose device queue it is: the signed-in person every write waiting in it,
 * or on its way to it, was made by.
 */
let owner: string | undefined;

/** Names the signed-in person, or no one once they are gone. */
export function setQueueOwner(userId: string | undefined): void {
  owner = userId;
}

export function queueOwner(): string | undefined {
  return owner;
}
