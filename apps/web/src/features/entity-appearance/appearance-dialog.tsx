import { queryClient } from '@queries/client';
import { refreshActiveGraphqlPreviewQueries } from '@queries/preview/active-queries';
import { refreshActiveGraphqlSoupQueries } from '@queries/soup/graphql/active-queries';
import { setEntityAppearance } from '@service-storage/entity-appearance';
import {
  acknowledgeGraphqlRestWrite,
  getGraphqlCacheHost,
  getGraphqlSoupClient,
} from '@service-storage/graphql-soup';
import { refreshProjectQueries } from '../projects/queries/project-revalidation';
import { createSaveEntityAppearance } from './queries/appearance';
import {
  AppearanceEditor,
  type AppearanceEditorProps,
} from './views/appearance-editor';

const saveEntityAppearance = createSaveEntityAppearance({
  queryClient,
  cacheHost: getGraphqlCacheHost,
  update: setEntityAppearance,
  acknowledgeWrite: acknowledgeGraphqlRestWrite,
  refreshUncached: async (entity) => {
    await Promise.all([
      refreshActiveGraphqlSoupQueries({ throwOnError: true }),
      refreshActiveGraphqlPreviewQueries(entity.id),
      ...(entity.type === 'initiative'
        ? [refreshProjectQueries(getGraphqlSoupClient())]
        : []),
    ]);
  },
});

/** Load the editor and its production adapters together, only when opened. */
export function AppearanceDialog(props: Omit<AppearanceEditorProps, 'save'>) {
  return (
    <AppearanceEditor
      {...props}
      save={(appearance) =>
        saveEntityAppearance(props.entity, appearance, props.isCurrent)
      }
    />
  );
}
