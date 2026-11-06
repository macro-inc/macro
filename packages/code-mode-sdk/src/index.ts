// Package the actual public SDK; no tool-name proxy or alternate SDK API.
export * from '../../sdk/src/macro';
// Trusted bootstrap installs diagnostics and the run's write policy for every
// client in this Deno process.
export {
  setDefaultRequestGate as gateRequests,
  setDefaultRequestObserver as observeRequests,
} from '../../sdk/src/utils/activity';
