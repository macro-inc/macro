import { createContext } from 'solid-js';

/** Prevent document references from recursively mounting the same canvas. */
export const CanvasAncestry = createContext<readonly string[]>([]);
