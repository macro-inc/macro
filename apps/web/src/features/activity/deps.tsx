import type { PropertyDefinitionDomain } from '@property/types';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import type { Client } from '@urql/core';
import {
  type Accessor,
  createContext,
  type JSX,
  type ParentProps,
  useContext,
} from 'solid-js';

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
 * The ambient capabilities every activity surface needs the same way. The
 * app wires the real implementations in `app-deps.tsx`; tests hand in
 * mocks. Per-surface policy (what a click opens) is a callback prop, not a
 * dep. No file under `queries/`, `state/`, `components/`, or `views/`
 * imports these capabilities directly.
 */
export type ActivityDeps = {
  /** GraphQL client for the activity queries. */
  graphql: Accessor<Client>;
  /** The signed-in user, so their own rows read "You". */
  currentUserId: Accessor<string>;
  /**
   * Display name for an actor id. Resolves to `undefined` when the id is
   * not a user (automation rows), `''` while loading, else the name.
   */
  displayName: (actorId: Accessor<string>) => Accessor<string | undefined>;
  /** Name, icon, and link target for a referenced entity. */
  entityDisplay: (
    entityId: Accessor<string>,
    entityType: Accessor<EntityType>
  ) => EntityDisplay;
  /** The property definition behind a property-changed row, when known. */
  propertyDefinition: (
    propertyId: Accessor<string | undefined>
  ) => Accessor<PropertyDefinitionDomain | undefined>;
  /** IANA time zone used to bucket the overview heatmap. */
  timeZone: () => string;
};

const ActivityDepsContext = createContext<ActivityDeps>();

export function ActivityDepsProvider(
  props: ParentProps<{ deps: ActivityDeps }>
) {
  return (
    <ActivityDepsContext.Provider value={props.deps}>
      {props.children}
    </ActivityDepsContext.Provider>
  );
}

export function useActivityDeps(): ActivityDeps {
  const deps = useContext(ActivityDepsContext);
  if (!deps) {
    throw new Error(
      'useActivityDeps must be used within an ActivityDepsProvider'
    );
  }
  return deps;
}
