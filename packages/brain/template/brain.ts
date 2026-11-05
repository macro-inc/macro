import { Brain, type Composition } from '@macro-inc/brain';

// This is my composition. Modules under brain/ can supply handlers and adapters.
// Keep the default event → Jev → lane → tier wiring until I need to change it.
const compose: Composition = (deps) =>
  new Brain(deps, {
    subscriptions: [],
  });

export default compose;
