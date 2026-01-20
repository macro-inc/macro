import { createQueryKeys } from '@lukemorales/query-key-factory';

export const projectsKeys = createQueryKeys('projects', {
  list: null,
});

export const pinsKeys = createQueryKeys('pins', {
  list: null,
});

export const deletedKeys = createQueryKeys('deleted', {
  list: null,
});

/**
 * @deprecated Use `projectsKeys`, `pinsKeys`, or `deletedKeys` directly
 */
export const storageKeys = {
  projects: projectsKeys,
  pins: pinsKeys,
  deleted: deletedKeys,
};
