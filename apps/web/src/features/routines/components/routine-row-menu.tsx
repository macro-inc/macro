import {
  SoupEntityActionDrawer,
  type SoupEntityDrawerActionGroup,
} from '@app/features/soup/SoupEntityActionDrawer';
import { t } from '@app/lib/i18n';
import { canOpenInNewTab } from '@components/app/tab-layout/open-in-new-tab';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import { deepEqual } from '@core/util/compareUtils';
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import {
  type Accessor,
  children,
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  on,
  type ParentProps,
  Show,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  canRunRoutine,
  canToggleRoutine,
  type RoutineMenuItem,
  routineMenuGroups,
} from '../core/routine-menu';
import type { RoutineRow } from '../core/types';

/** What a routine row's menu does; the host omits what it can't offer. */
export type RoutineRowMenuActions = {
  /** Omit where the host can't open a routine beside the list. */
  onOpenInNewSplit?(row: RoutineRow): void;
  /** Without room for another split, the open would replace the list. */
  canOpenInNewSplit(): boolean;
  /** Omit where the host can't open a routine in a new desktop tab. */
  onOpenInNewTab?(row: RoutineRow): void;
  onRun(row: RoutineRow): void;
  /** "Run now" was chosen and the server hasn't answered yet. */
  runPending(row: RoutineRow): boolean;
  onDuplicate(row: RoutineRow): void;
  onKeep(row: RoutineRow): void;
  onCopyLink(row: RoutineRow): void;
  onCopyId(row: RoutineRow): void;
  /** Omit where routines can't be shared. */
  onShare?(row: RoutineRow): void;
  onDelete(row: RoutineRow): void;
  /** The routine named at the top of the phone drawer. */
  entity(row: RoutineRow): EntityData | undefined;
};

type RoutineRowMenuProps = {
  row: RoutineRow;
  /** A sub-routine, listed under the routine whose run created it. */
  nested?: boolean;
  /** Its on/off change is saving. */
  pending: boolean;
  onToggle(row: RoutineRow): void;
  /** Absent where the list has no row menu. */
  actions?: RoutineRowMenuActions;
};

/** One entry, shown as a menu item on desktop and a drawer row on a phone. */
type RoutineMenuEntry = {
  id: RoutineMenuItem;
  label: string;
  /** Read where it renders: it follows the row. */
  readonly disabled: boolean;
  destructive: boolean;
  /** Acts on the row as it is when chosen. */
  run(): void;
};

function routineMenuEntry(
  id: RoutineMenuItem,
  props: RoutineRowMenuProps,
  actions: RoutineRowMenuActions
): RoutineMenuEntry {
  const entry = (
    label: string,
    run: (row: RoutineRow) => void,
    disabled: () => boolean = () => false,
    destructive = false
  ): RoutineMenuEntry => ({
    id,
    label,
    get disabled() {
      return disabled();
    },
    destructive,
    run: () => run(props.row),
  });
  return match(id)
    .with('open-in-split', () =>
      entry(
        t('entityActions.openInNewSplit'),
        (row) => actions.onOpenInNewSplit?.(row),
        () => !actions.canOpenInNewSplit()
      )
    )
    .with('open-in-tab', () =>
      entry(t('entityActions.openInNewTab'), (row) =>
        actions.onOpenInNewTab?.(row)
      )
    )
    .with('run-now', () =>
      entry(
        t('routineMenu.runNow'),
        (row) => actions.onRun(row),
        () => !canRunRoutine(props.row, actions.runPending(props.row))
      )
    )
    .with('turn-off', 'turn-on', (toggle) =>
      entry(
        toggle === 'turn-off'
          ? t('routineMenu.turnOff')
          : t('routineMenu.turnOn'),
        (row) => props.onToggle(row),
        () => !canToggleRoutine(props.row, props.pending)
      )
    )
    .with('duplicate', () =>
      entry(t('entityActions.duplicate'), (row) => actions.onDuplicate(row))
    )
    .with('keep', () =>
      entry(t('subRoutines.keep'), (row) => actions.onKeep(row))
    )
    .with('copy-link', () =>
      entry(t('entityActions.copyLink'), (row) => actions.onCopyLink(row))
    )
    .with('copy-id', () =>
      entry(t('entityActions.copyId'), (row) => actions.onCopyId(row))
    )
    .with('share', () =>
      entry(t('entityActions.share'), (row) => actions.onShare?.(row))
    )
    .with('delete', () =>
      entry(
        t('entityActions.delete'),
        (row) => actions.onDelete(row),
        () => false,
        true
      )
    )
    .exhaustive();
}

/**
 * The row's entries, rebuilt only when which entries it has changes: a list
 * update makes a new row object, and rebuilding the entries of an open menu
 * would remount its items and drop the one in focus.
 */
function createRoutineMenuEntries(
  props: RoutineRowMenuProps,
  actions: Accessor<RoutineRowMenuActions>
) {
  const groups = createMemo(
    () => {
      // Phones show one pane, so nothing opens beside the list there.
      const desktop = !isMobile();
      return routineMenuGroups(props.row, {
        nested: Boolean(props.nested),
        splits: desktop && Boolean(actions().onOpenInNewSplit),
        tabs: desktop && Boolean(actions().onOpenInNewTab) && canOpenInNewTab(),
        share: Boolean(actions().onShare),
      });
    },
    undefined,
    { equals: deepEqual }
  );
  return createMemo(() =>
    groups().map((group) =>
      group.map((id) => routineMenuEntry(id, props, actions()))
    )
  );
}

const drawerGroups = (
  entries: RoutineMenuEntry[][]
): SoupEntityDrawerActionGroup[] =>
  entries.map((group) => ({
    items: group.map((entry) => ({
      id: entry.id,
      label: entry.label,
      get disabled() {
        return entry.disabled;
      },
      destructive: entry.destructive,
      onClick: entry.run,
    })),
  }));

/**
 * A routine row's actions: a right-click menu on desktop and tablets and, as
 * on the task and project lists, a long-press drawer on a phone.
 */
export function RoutineRowMenu(props: ParentProps<RoutineRowMenuProps>) {
  const row = children(() => props.children);
  const [drawerOpen, setDrawerOpen] = createSignal(false);
  // Event handling, not composition, differs on a phone: the row is the same.
  const openDrawer = () => {
    if (isMobile()) setDrawerOpen(true);
  };
  return (
    <Show when={props.actions} fallback={row()}>
      {(actions) => {
        const entries = createRoutineMenuEntries(props, actions);
        const drawer = createMemo(() => drawerGroups(entries()));
        return (
          <>
            <ContextMenu>
              <ContextMenuTrigger
                as="div"
                class="group/routine-menu"
                disabled={isMobile()}
                ref={(element: HTMLElement) =>
                  // A tablet gets the context menu's own long press, and a
                  // phone turned past the phone width becomes one.
                  createRenderEffect(
                    on(isMobile, (mobile) => {
                      if (mobile)
                        touchHandler(element, () => ({
                          onLongPress: openDrawer,
                        }));
                    })
                  )
                }
                onContextMenu={(event: MouseEvent) => {
                  // Android reports a long press as a context menu too.
                  if (!isMobile()) return;
                  event.preventDefault();
                  openDrawer();
                }}
              >
                {row()}
              </ContextMenuTrigger>
              <ContextMenu.Portal>
                <ContextMenuContent class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted">
                  <For each={entries()}>
                    {(group, index) => (
                      <>
                        <Show when={index() > 0}>
                          <MenuSeparator />
                        </Show>
                        <For each={group}>
                          {(entry) => (
                            <MenuItem
                              text={entry.label}
                              disabled={entry.disabled}
                              class={
                                entry.destructive
                                  ? 'text-failure-ink'
                                  : undefined
                              }
                              onClick={entry.run}
                            />
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </ContextMenuContent>
              </ContextMenu.Portal>
            </ContextMenu>
            <Show when={drawerOpen()}>
              <SoupEntityActionDrawer
                entity={actions().entity(props.row)}
                groups={drawer()}
                open
                onOpenChange={setDrawerOpen}
              />
            </Show>
          </>
        );
      }}
    </Show>
  );
}
