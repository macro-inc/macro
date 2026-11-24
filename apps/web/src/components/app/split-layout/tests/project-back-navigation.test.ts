import { paneRoute } from '@app/routes/app-route';
import { describe, expect, it } from 'vitest';
import type { SplitContent } from '../layoutManager';
import {
  projectBackFallback,
  projectLocation,
} from '../project-back-navigation';

const projectId = '01992d2f-8444-7000-8000-000000000001';

function projectContent(section: string): SplitContent {
  return {
    type: 'component',
    id: 'tasks',
    entryMetadata: {
      route: paneRoute(
        { id: 'view-tasks', params: {} },
        { id: 'tasks-project', params: { projectId, section } }
      ),
    },
  };
}

describe('projectLocation', () => {
  it.each(['overview', 'tasks', 'time'])(
    'reads a project on its %s section, so its pane keeps Back',
    (section) => {
      expect(projectLocation(projectContent(section))).toEqual({
        kind: 'detail',
        projectId,
        section,
      });
      expect(projectBackFallback(projectContent(section))).toBeDefined();
    }
  );

  it('reads no project from an unknown section', () => {
    expect(projectLocation(projectContent('board'))).toBeUndefined();
  });
});
