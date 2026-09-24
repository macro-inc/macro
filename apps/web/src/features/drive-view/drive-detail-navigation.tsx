import { entityDetailBlockType } from '@app/components/entity-detail/EntityDetail';
import type {
  EntityDetailNavigationOptions,
  EntityDetailNavigationStackEntry,
  EntityDetailTarget,
} from '@app/components/entity-detail/EntityDetailNavigationStack';
import {
  routeParams,
  useCanGo,
  useNavigate,
  useParams,
  useSplitHistory,
} from '@app/split-router';
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
  type DriveDocumentRoute,
  type DriveRouteParams,
  driveDocumentFromParams,
  driveDocumentRoute,
} from './primitives/drive-route';

type DriveDetailHistoryEntry = EntityDetailNavigationStackEntry & {
  historyIndex: number;
};

type DriveDetailNavigation = {
  entries: Accessor<readonly DriveDetailHistoryEntry[]>;
  active: Accessor<DriveDetailHistoryEntry | undefined>;
  navigate: (
    target: EntityDetailTarget,
    options?: EntityDetailNavigationOptions
  ) => boolean;
  pop: () => void;
  popTo: (value: string) => void;
  clear: (options?: { replace?: boolean }) => void;
};

const Context = createContext<DriveDetailNavigation>();

function targetFromDocument(
  document: DriveDocumentRoute | undefined
): Extract<EntityDetailTarget, { type: 'document' }> | undefined {
  if (!document) return;

  const target = {
    type: 'document' as const,
    id: document.id,
  };

  switch (document.type) {
    case 'task':
      return {
        ...target,
        fileType: 'md',
        subType: { type: 'task', is_completed: false },
      };
    case 'snippet':
    case 'skill':
      return {
        ...target,
        fileType: 'md',
        subType: { type: document.type },
      };
    default:
      return { ...target, fileType: document.type };
  }
}

function targetFromParams(params: DriveRouteParams) {
  return targetFromDocument(driveDocumentFromParams(params));
}

function sameTarget(
  left: EntityDetailTarget | undefined,
  right: EntityDetailTarget | undefined
) {
  if (left?.type !== 'document' || right?.type !== 'document') {
    return left === right;
  }

  return (
    left.id === right.id &&
    left.fileType === right.fileType &&
    left.subType?.type === right.subType?.type
  );
}

function opensInline(options?: EntityDetailNavigationOptions) {
  const event = options?.event;
  return (
    !isTouchDevice() &&
    !(event?.shiftKey || event?.metaKey || event?.ctrlKey || event?.altKey)
  );
}

export function DriveDetailNavigationProvider(
  props: ParentProps<{ location: Accessor<DriveLocation> }>
) {
  const params = useParams<DriveRouteParams>();
  const navigate = useNavigate();
  const canGoBack = useCanGo(-1);
  const history = useSplitHistory();
  const selectPreview = createPreviewSelectionGuard();
  const activeTarget = createMemo(() => targetFromParams(params));

  createEffect(on(activeTarget, (target) => selectPreview(target)));

  const entries = createMemo<DriveDetailHistoryEntry[]>(() => {
    const snapshot = history();
    if (!snapshot) return [];

    const result: DriveDetailHistoryEntry[] = [];
    for (let index = 0; index <= snapshot.index; index += 1) {
      const target = targetFromParams(
        routeParams(snapshot.entries[index]?.route) as DriveRouteParams
      );

      if (!target) {
        result.splice(0);
        continue;
      }

      const entry = {
        value: `drive-history:${index}`,
        data: target,
        historyIndex: index,
      };
      const previous = result.at(-1);
      if (sameTarget(previous?.data, target)) result[result.length - 1] = entry;
      else result.push(entry);
    }

    return result;
  });
  const active = () => entries().at(-1);

  const value: DriveDetailNavigation = {
    entries,
    active,

    navigate(target, options) {
      if (target.type !== 'document' || !opensInline(options)) return false;

      const blockType = entityDetailBlockType(target);
      if (!blockType || !selectPreview(target)) return false;

      navigate(
        driveDestination(
          props.location(),
          driveDocumentRoute({
            id: target.id,
            fileType: target.fileType ?? blockType,
            subType: target.subType?.type,
          })
        )
      );
      return true;
    },

    pop() {
      if (canGoBack()) navigate(-1);
      else value.clear({ replace: true });
    },

    popTo(value) {
      const entry = entries().find((candidate) => candidate.value === value);
      const snapshot = history();
      if (!entry || !snapshot) return;

      navigate(entry.historyIndex - snapshot.index);
    },

    clear(options) {
      // Location navigation already lands on a list route. Clearing again must
      // not climb out of the folder/tab the user just selected.
      if (!driveDocumentFromParams(params)) return;
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
