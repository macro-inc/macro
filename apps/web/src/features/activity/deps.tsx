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

export type OpenEntityTarget = {
  block: string;
  id: string;
  params?: Record<string, string>;
  newSplit: boolean;
};

/**
 * Everything the activity feature reaches outside itself for. The app wires
 * the real implementations in `app-deps.tsx`; tests hand in fakes. No file
 * under `queries/`, `state/`, `components/`, or `views/` imports these
 * capabilities directly.
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
  /** Open an entity in the split layout. */
  openEntity: (target: OpenEntityTarget) => void;
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

export function useOptionalActivityDeps(): ActivityDeps | undefined {
  return useContext(ActivityDepsContext);
}

export function useActivityDeps(): ActivityDeps {
  const deps = useOptionalActivityDeps();
  if (!deps) {
    throw new Error(
      'useActivityDeps must be used within an ActivityDepsProvider'
    );
  }
  return deps;
}
