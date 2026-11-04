// Package the actual public SDK; no tool-name proxy or alternate SDK API.
export * from '../../sdk/src/macro';
// Trusted bootstrap installs diagnostics for every client in this Deno process.
export { setDefaultRequestObserver as observeRequests } from '../../sdk/src/utils/activity';
