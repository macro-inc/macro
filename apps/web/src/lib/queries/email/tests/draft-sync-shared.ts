/** Identities every simulated page signs in with. */
export const ACCOUNT = 'owner';
export const INBOX = 'inbox';
export const SENDER = 'me@example.com';

/** How a page that reloaded hears back from anything it started: never. */
export const never = <T>() => new Promise<T>(() => {});
