/**
 * When this app build was made, in ms since the epoch, or 0 where the bundler
 * did not stamp it (tests and harnesses). A newer build takes the local cache
 * database over from tabs of an older one.
 */
export const APP_BUILD_TIME: number = import.meta.env.__APP_BUILD_TIME__ ?? 0;
