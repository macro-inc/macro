import { expect, it } from 'vitest';
import { DEFAULT_PROJECT_SETTINGS } from './project';
import {
  decodeProjectSavedView,
  readProjectSavedView,
} from './project-saved-view';

it('reads a legacy created project view as My projects without changing its source', () => {
  const stored = {
    kind: 'projects',
    version: 1,
    scope: 'created-by-me',
    settings: { ...DEFAULT_PROJECT_SETTINGS, layout: 'gantt', mine: true },
  };
  const decoded = decodeProjectSavedView(stored);
  expect(decoded.isOk()).toBe(true);
  expect(readProjectSavedView(stored).config).toEqual({
    ...stored,
    scope: 'assigned-to-me',
  });
  expect(stored.scope).toBe('created-by-me');
  expect(stored.settings).toEqual({
    ...DEFAULT_PROJECT_SETTINGS,
    layout: 'gantt',
    mine: true,
  });
});
