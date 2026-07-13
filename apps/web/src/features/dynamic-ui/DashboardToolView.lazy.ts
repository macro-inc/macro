import { lazy } from 'solid-js';

/**
 * Lazy boundary for the dashboard view.
 *
 * The dynamic-ui tree is entity-heavy and sits inside a module-init cycle
 * (`entity.ts` ⇄ `DocumentPreview`/`StaticMarkdown` ⇄ the `@entity` barrel).
 * Importing it *eagerly* from the chat startup bundle enters that cycle in the
 * wrong order and throws a TDZ `ReferenceError` ("Cannot access 'EntityTitle'
 * before initialization").
 *
 * Like the split-layout component registry (which `lazy(() => import())`s every
 * heavy block UI), we keep the boundary here in `@app` and dynamic-import the
 * real component. Eager consumers in `core` (the AI tool handler) then reference
 * this with a normal STATIC import — the heavy tree stays behind the dynamic
 * import, so it never lands in the startup graph and the cycle never bites.
 */
export const DashboardToolView = lazy(() => import('./DashboardToolView'));
