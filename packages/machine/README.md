# Machine

`@macro-inc/machine` runs a pure, typed transition table in plain TypeScript.
The core has no runtime dependencies. Solid integration is available separately
from `@macro-inc/machine/solid`.

```ts
import { createMachine } from '@macro-inc/machine';

const machine = createMachine({ initial, def, scopes, execute });
const initialSnapshot = machine.getState();
const unsubscribe = machine.subscribe((state) => console.log(state));
machine.dispatch(event);
unsubscribe();
machine.dispose();
```

A definition returns the next state and optional commands, or `undefined` to
ignore an event. `step` and `simulate` exercise those decisions without running
scopes or commands.

Scopes start work and optionally return a cleanup function. Every accepted
transition cleans up the previous scope, enters the next state, starts its
scope, notifies subscribers, then executes commands in order. This also applies
to transitions with the same state tag. Ignored events leave the scope alone.
The outgoing cleanup can still read the old state through `getState()`.

Nested dispatches from scopes, cleanups, subscribers, and commands queue until
the current transition finishes. The initial scope runs before `createMachine`
returns, including any events it sends. Subscriptions receive future accepted
transitions; use `getState()` to read the initial snapshot.

Disposal cleans up the active scope, removes subscriptions, and makes subsequent
dispatches no-ops. Call it when the machine is no longer needed.

## Solid

```ts
import { createSolidMachine } from '@macro-inc/machine/solid';

const machine = createSolidMachine({ initial, def, scopes, execute });
machine.state(); // Reactive snapshot.
machine.matches('flashing'); // Reactive read narrowed to that state.
machine.dispatch(event);
```

The adapter owns its machine and disposes it when its Solid owner is disposed.
Outside a Solid owner, call `machine.dispose()` explicitly. Scope callbacks
normally return cleanup directly, just as they do in the core.

Use `solidScope` when a callback needs Solid computations or context. Register
cleanup with `onCleanup` inside this callback. Configure it under the owner
whose context it should inherit:

```ts
import { createSolidMachine, solidScope } from '@macro-inc/machine/solid';
import { onCleanup } from 'solid-js';

const machine = createSolidMachine({
  initial,
  def,
  scopes: {
    flashing: solidScope((_state, dispatch) => {
      const timer = setTimeout(() => dispatch({ t: 'flash-elapsed' }), 1000);
      onCleanup(() => clearTimeout(timer));
    }),
  },
});
```

Each invocation gets a fresh Solid root. Leaving the state disposes that root,
including its computations and cleanups. The core only receives its disposer.
