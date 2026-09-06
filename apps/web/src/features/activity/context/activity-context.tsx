import { useUserId } from '@core/context/user';
import { tryMacroId, useDisplayName } from '@core/user';
import { useAllProperties } from '@property/editor/hooks/useAllProperties';
import { usePropertyEntityDisplay } from '@property/hooks';
import type { PropertyDefinitionDomain } from '@property/types';
import { useBotsQuery } from '@queries/bots/bots';
import {
  firstPartyBotName,
  getBotDisplayName,
} from '@queries/channel/message-sender';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { getGraphqlSoupClient } from '@service-storage/graphql-soup';
import type { Client } from '@urql/core';
import { type Accessor, createContext, type JSX, useContext } from 'solid-js';

/** Resolved display for one referenced entity: name, icon, and link target. */
export type EntityDisplay = {
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
   * it loads, `Bot` when the list does not know the id.
   */
  botName: (botId: Accessor<string>) => Accessor<string | undefined>;
  /** Name, icon, and link target for a referenced entity. */
  entityDisplay: (
    entityId: Accessor<string>,
    entityType: Accessor<EntityType>
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
  return {
    graphql: () => getGraphqlSoupClient(),
    currentUserId: () => userId() ?? '',
    displayName: (actorId) => {
      const id = tryMacroId(actorId());
      if (!id) return () => undefined;
      const [name] = useDisplayName(id, { emailFallback: 'local-part' });
      return name;
    },
    botName: (botId) => {
      const bots = useBotsQuery();
      return () => {
        const id = botId();
        const firstParty = firstPartyBotName(id);
        if (firstParty) return firstParty;
        if (!bots.isSuccess) return undefined;
        return getBotDisplayName(`bot|${id}`, undefined, bots.data);
      };
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
  };
}
