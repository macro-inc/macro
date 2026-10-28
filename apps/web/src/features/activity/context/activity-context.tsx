import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { EntityIcon as CoreEntityIcon } from '@core/component/EntityIcon';
import { enableDatabases, enableForms } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { PropertyDefinitionDomain } from '@property/types';
import { useBotsQuery } from '@queries/bots/bots';
import {
  firstPartyBotName,
  getBotDisplayName,
} from '@queries/messages/message-sender';
import { useDatabasesQuery } from '@queries/storage/databases';
import { useFormDetailQuery } from '@queries/storage/forms';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createContext,
  getOwner,
  type JSX,
  runWithOwner,
  useContext,
} from 'solid-js';
import type {
  ActivityDisplayEntityType,
  ActivityEntityType,
} from '../core/event';

/** Resolved display for one referenced entity: name, icon, and link target. */
export type EntityDisplay = {
  /** Authorized native project target; projects have no document block. */
  nativeProjectId?: Accessor<string | undefined>;
  name: Accessor<string>;
  icon: Accessor<JSX.Element>;
  isLoading: Accessor<boolean>;
  blockOrFileType: Accessor<string | null>;
  linkParams: Accessor<Record<string, string> | undefined>;
};

/** What a row asks its host to open. The host decides how. */
export type OpenEntityTarget = {
  block: string;
  id: string;
  params?: Record<string, string>;
  newSplit: boolean;
};

/**
 * The ambient capabilities activity reads the same way on every surface.
 * Production resolves them from the app below; tests swap them through
 * `ActivityContextProvider`. Per-surface policy (what a click opens) is a
 * callback prop, not a context field. No file under `queries/`,
 * `primitives/`, `components/`, or `views/` imports these capabilities
 * directly.
 */
export type ActivityContext = {
  /** GraphQL client for the activity queries. */
  graphql: Accessor<Client>;
  /** The signed-in user, so their own rows read "You". */
  currentUserId: Accessor<string>;
  /**
   * Display name for a user actor id. Resolves to `undefined` when the id
   * is not a user, `''` while loading, else the name.
   */
  displayName: (actorId: Accessor<string>) => Accessor<string | undefined>;
  /**
   * Display name for a bot by bare UUID. First-party bots resolve at once
   * from constants; team bots resolve from the bots list, `undefined` while
   * it loads, `Bot` when the list does not know the id or failed to load.
   */
  botName: (botId: Accessor<string>) => Accessor<string | undefined>;
  /**
   * Whether rows about this kind of entity show at all. Reactive: a kind
   * behind a rollout appears once its flag resolves on.
   */
  entityTypeShown: (entityType: ActivityEntityType) => boolean;
  /** Name, icon, and link target for a referenced entity. */
  entityDisplay: (
    entityId: Accessor<string>,
    entityType: Accessor<ActivityDisplayEntityType>
  ) => EntityDisplay;
  /** The property definition behind a property-changed row, when known. */
  propertyDefinition: (
    propertyId: Accessor<string | undefined>
  ) => Accessor<PropertyDefinitionDomain | undefined>;
};

const ActivityContextValue = createContext<ActivityContext>();

/** Test seam. Production never mounts this; `useActivityContext` falls back to the app. */
export const ActivityContextProvider = ActivityContextValue.Provider;

export function useActivityContext(): ActivityContext {
  return useContext(ActivityContextValue) ?? appActivityContext();
}

function appActivityContext(): ActivityContext {
  const userId = useUserId();
  // One bots subscription per consumer, made under the consumer's owner the
  // first time a bot row asks for a name and reused after that, so it is not
  // rebuilt each time a recycled row changes actor and user-only surfaces
  // never fetch the list at all.
  const owner = getOwner();
  let bots: ReturnType<typeof useBotsQuery> | undefined;
  const botsQuery = () => (bots ??= runWithOwner(owner, useBotsQuery));
  // Database names come from one list subscription, made the same way.
  let databases: DatabasesQuery | undefined;
  const databasesQuery = () =>
    (databases ??= runWithOwner(owner, useDatabasesQuery));
  const databasesFlag = useFeatureFlag(enableDatabases);
  const formsFlag = useFeatureFlag(enableForms);
  return {
    graphql: () => getGraphqlSoupClient(),
    currentUserId: () => userId() ?? '',
    displayName: (actorId) => {
      const id = tryMacroId(actorId());
      if (!id) return () => undefined;
      const [name] = useDisplayName(id, { emailFallback: 'local-part' });
      return name;
    },
    botName: (botId) => () => {
      const id = botId();
      const firstParty = firstPartyBotName(id);
      if (firstParty) return firstParty;
      const list = botsQuery();
      if (!list || list.isPending) return undefined;
      return getBotDisplayName(`bot|${id}`, undefined, list.data ?? []);
    },
    entityTypeShown: (entityType) =>
      (entityType !== 'database' || databasesFlag().enabled) &&
      (entityType !== 'form' || formsFlag().enabled),
    entityDisplay: (entityId, entityType) => {
      const type = entityType();
      if (type === 'DATABASE') {
        return databaseEntityDisplay(entityId, databasesQuery);
      }
      if (type === 'FORM') return formEntityDisplay(entityId);
      return usePropertyEntityDisplay(entityId, () => type);
    },
    propertyDefinition: (propertyId) => {
      const definitions = useAllProperties();
      return () => {
        const id = propertyId();
        return id ? definitions().find((def) => def.id === id) : undefined;
      };
    },
  };
}

/** A form's name from its own detail, which any respondent can read. */
function formEntityDisplay(entityId: Accessor<string>): EntityDisplay {
  const detail = useFormDetailQuery(entityId);
  return {
    name: () => {
      if (detail.isPending) return 'Loading...';
      return detail.isSuccess ? detail.data.form.name : 'Form unavailable';
    },
    icon: () => <CoreEntityIcon targetType="form" size="xs" />,
    isLoading: () => detail.isPending,
    blockOrFileType: () => 'form',
    linkParams: () => undefined,
  };
}

type DatabasesQuery = ReturnType<typeof useDatabasesQuery>;

function databaseEntityDisplay(
  entityId: Accessor<string>,
  databasesQuery: () => DatabasesQuery | undefined
): EntityDisplay {
  const isLoading = () => databasesQuery()?.isPending ?? true;
  return {
    name: () => {
      const list = databasesQuery();
      if (!list || list.isPending) return 'Loading...';
      const id = entityId();
      const listed = list.isSuccess
        ? list.data.find((entry) => entry.database.id === id)
        : undefined;
      return listed?.database.name ?? 'Database unavailable';
    },
    icon: () => <CoreEntityIcon targetType="database" size="xs" />,
    isLoading,
    blockOrFileType: () => 'database',
    linkParams: () => undefined,
  };
}
