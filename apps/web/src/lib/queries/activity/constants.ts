/**
 * Activity query constants. A leaf module: the realtime push handler (which
 * the soup client module transitively imports) needs these without creating
 * an import cycle through the query factories.
 */

/** How many activity rows an entity's side-panel preview requests. */
export const ENTITY_ACTIVITY_PREVIEW_LIMIT = 20;
