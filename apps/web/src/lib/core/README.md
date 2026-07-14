# Core

Shared app infrastructure used across Macro's web and desktop surfaces. This
directory is internal to `apps/web`; it is not a standalone package or public
API.

It contains the block runtime, collaboration primitives, cross-cutting Solid
contexts, and low-level components and utilities that are genuinely shared by
multiple features. Product-specific code should stay under `src/features`.

Imports use the `@core/*` alias configured in `apps/web/tsconfig.json`:

```ts
import { toast } from '@core/component/Toast/Toast';
```

Run the core test project from `apps/web` with
`bunx vitest run --project core`.
