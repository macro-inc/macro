import { openDocument } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { usePropertyEntityDisplay } from '@property/hooks';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { ParentProps } from 'solid-js';
import {
  type ActivityDeps,
  ActivityDepsProvider,
  useOptionalActivityDeps,
} from './deps';

/** The production wiring. Call inside the app's user and split contexts. */
export function createAppActivityDeps(): ActivityDeps {
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
    openEntity: ({ block, id, params, newSplit }) =>
      openDocument(block, id, params, newSplit),
    timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  };
}

/**
 * Mounts the app wiring at a composition root. Reuses an enclosing provider
 * when one exists, so a test can wrap a root in fakes.
 */
export function AppActivityDeps(props: ParentProps) {
  const existing = useOptionalActivityDeps();
  return (
    <ActivityDepsProvider deps={existing ?? createAppActivityDeps()}>
      {props.children}
    </ActivityDepsProvider>
  );
}
