import { z } from 'zod';
import { SCENE_PARAM } from './core/scenes';

/**
 * The open scene, in the artifact pane's search. Shared links carry a plain
 * `?scene=`, which entry moves into this namespace.
 */
export const artifactSearch = {
  namespace: 'artifact',
  schema: z.object({ [SCENE_PARAM]: z.string() }),
  defaults: { [SCENE_PARAM]: '' },
};
