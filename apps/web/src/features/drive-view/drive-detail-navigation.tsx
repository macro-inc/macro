import { entityDetailBlockType } from '@app/components/entity-detail/EntityDetail';
import type {
  EntityDetailNavigationOptions,
  EntityDetailNavigationStackEntry,
  EntityDetailTarget,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import { useNavigate, useParams, useRouteState } from '@app/split-router';
import { createPreviewSelectionGuard } from '@components/app/createPreviewSelectionGuard';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  on,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { DriveLocation } from './core/types';
import { driveDestination } from './drive-route-navigation';
import {
  type DriveDocumentTarget,
  documentRouteFromTarget,
  documentTargetFromRoute,
  sameDocumentRoute,
} from './primitives/drive-detail-trail';
import {
  type DriveDocumentRoute,
  type DriveRouteParams,
  driveDocumentFromParams,
  driveDocumentRoute,
} from './primitives/drive-route';
import { driveSplitRoute } from './route';

type DriveDetailRootOptions = EntityDetailNavigationOptions & {
  location?: DriveLocation;
};

type DriveDetailNavigation = {
  entries: Accessor<readonly EntityDetailNavigationStackEntry[]>;
  active: Accessor<EntityDetailNavigationStackEntry | undefined>;
  navigate: (
    target: EntityDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => boolean;
  openRoot: (
    target: EntityDetailTarget,
    options?: DriveDetailRootOptions
  ) => boolean;
  pop: () => void;
  popTo: (value: string) => void;
  clear: (options?: { replace?: boolean }) => void;
};

const Context = createContext<DriveDetailNavigation>();

function opensInline(options?: EntityDetailNavigationOptions) {
  if (isTouchDevice()) return false;

  const event = options?.event;
  if (!event) return true;
  if (event.shiftKey) return false;
  if (event.metaKey) return false;
  if (event.ctrlKey) return false;
  if (event.altKey) return false;
  return true;
}

export function DriveDetailNavigationProvider(
  props: ParentProps<{ location: Accessor<DriveLocation> }>
) {
  const params = useParams<DriveRouteParams>();
  const navigate = useNavigate();
  const routeTrail = useRouteState(driveSplitRoute);
  const selectPreview = createPreviewSelectionGuard();
  const activeDocument = createMemo(() => driveDocumentFromParams(params));
  const activeTarget = createMemo(() =>
    documentTargetFromRoute(activeDocument())
  );

  createEffect(on(activeTarget, (target) => selectPreview(target)));

  const trail = (): DriveDocumentTarget[] => {
    const restored = routeTrail();
    const endpoint = restored?.at(-1);
    const endpointMatches =
      endpoint !== undefined &&
      sameDocumentRoute(documentRouteFromTarget(endpoint), activeDocument());
    if (restored && endpointMatches) return restored;

    const target = activeTarget();
    if (!target) return [];
    return [target];
  };

  const entries = createMemo<EntityDetailNavigationStackEntry[]>(() =>
    trail().map((target, index) => ({
      value: `drive-detail:${index}:${documentRouteFromTarget(target).type}:${target.id}`,
      data: target,
    }))
  );
  const active = () => entries().at(-1);

  const resolveTarget = (
    target: EntityDetailTarget,
    options?: EntityDetailNavigationOptions
  ):
    | { target: DriveDocumentTarget; document: DriveDocumentRoute }
    | undefined => {
    if (target.type !== 'document') return;
    if (!opensInline(options)) return;

    const blockType = entityDetailBlockType(target);
    if (!blockType) return;
    if (!selectPreview(target)) return;

    return {
      target,
      document: driveDocumentRoute({
        id: target.id,
        fileType: target.fileType ?? blockType,
        subType: target.subType?.type,
      }),
    };
  };

  const value: DriveDetailNavigation = {
    entries,
    active,

    navigate(target, options) {
      const resolved = resolveTarget(target, options);
      if (!resolved) return false;

      const currentTrail = trail();
      const endpoint = currentTrail.at(-1);
      const endpointMatches =
        endpoint !== undefined &&
        sameDocumentRoute(documentRouteFromTarget(endpoint), resolved.document);
      if (endpointMatches) return true;

      navigate(driveDestination(props.location(), resolved.document), {
        state: [...currentTrail, resolved.target],
      });
      return true;
    },

    openRoot(target, options) {
      const resolved = resolveTarget(target, options);
      if (!resolved) return false;

      navigate(
        driveDestination(
          options?.location ?? props.location(),
          resolved.document
        ),
        { state: [resolved.target] }
      );
      return true;
    },

    pop() {
      const currentEntries = entries();
      if (currentEntries.length > 1) {
        value.popTo(currentEntries.at(-2)!.value);
        return;
      }
      value.clear({ replace: true });
    },

    popTo(value) {
      const currentEntries = entries();
      const entryIndex = currentEntries.findIndex(
        (candidate) => candidate.value === value
      );
      if (entryIndex < 0) return;
      if (entryIndex === currentEntries.length - 1) return;

      const nextTrail = currentEntries
        .slice(0, entryIndex + 1)
        .map((candidate) => candidate.data)
        .filter(
          (candidate): candidate is DriveDocumentTarget =>
            candidate.type === 'document'
        );
      const target = nextTrail.at(-1);
      if (!target) return;

      navigate(
        driveDestination(props.location(), documentRouteFromTarget(target)),
        { state: nextTrail }
      );
    },

    clear(options) {
      // Location navigation already lands on a list route. Clearing again must
      // not climb out of the folder/tab the user just selected.
      if (!activeDocument()) return;
      selectPreview(undefined);
      navigate(driveDestination(props.location()), {
        replace: options?.replace,
      });
    },
  };

  return <Context.Provider value={value}>{props.children}</Context.Provider>;
}

export function useDriveDetailNavigation(): DriveDetailNavigation {
  const context = useContext(Context);
  if (!context) throw new Error('DriveDetailNavigationProvider is required');

  return context;
}
