/**
 * The one rule many calls inputs share that a type can't state: an id or a
 * name given must not be empty.
 */

/** `value`, or an error naming `what` if it is empty. */
export const filled = (value: string, what: string): string => {
	if (value.length === 0) throw new Error(`${what} must not be empty`);
	return value;
};
