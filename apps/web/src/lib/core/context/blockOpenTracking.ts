import { createContext } from 'solid-js';

/**
 * Delay before a mounted block is recorded as opened. Presentation layers may
 * provide a delay for passively displayed content; ordinary blocks default to
 * immediate tracking.
 */
export const BlockOpenTrackingDelayContext = createContext(0);
