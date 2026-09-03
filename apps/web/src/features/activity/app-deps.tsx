import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { usePropertyEntityDisplay } from '@property/hooks';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { ParentProps } from 'solid-js';
import { type ActivityDeps, ActivityDepsProvider } from './deps';

function createAppActivityDeps(): ActivityDeps {
  const userId = useUserId();
  return {
    graphql: () => getGraphqlSoupClient(),
    currentUserId: () => userId() ?? '',
    displayName: (actorId) => {
      const id = tryMacroId(actorId());
      if (!id) return () => undefined;
      const [name] = useDisplayName(id, { emailFallback: 'local-part' });
      return name;
    },
    entityDisplay: (entityId, entityType) =>
      usePropertyEntityDisplay(entityId, entityType),
    propertyDefinition: (propertyId) => {
      const definitions = useAllProperties();
      return () => {
        const id = propertyId();
        return id ? definitions().find((def) => def.id === id) : undefined;
      };
    },
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

/**
 * Mounts the app wiring once, at the app root, so every activity surface
 * (feed view, side-panel sections, AI tool rows) shares it. Tests never
 * render this; they provide mocks through `ActivityDepsProvider`.
 */
export function AppActivityDeps(props: ParentProps) {
  return (
    <ActivityDepsProvider deps={createAppActivityDeps()}>
      {props.children}
    </ActivityDepsProvider>
  );
}
