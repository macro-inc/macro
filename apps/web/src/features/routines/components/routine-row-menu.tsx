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
import type { EntityData } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { children, createSignal, For, type ParentProps, Show } from 'solid-js';
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
  disabled?: boolean;
  destructive?: boolean;
  run(): void;
};

function routineMenuEntries(
  props: RoutineRowMenuProps,
  actions: RoutineRowMenuActions
): RoutineMenuEntry[][] {
  const row = props.row;
  const entry = (
    id: RoutineMenuItem,
    label: string,
    run: () => void,
    extra: { disabled?: boolean; destructive?: boolean } = {}
  ): RoutineMenuEntry => ({ id, label, run, ...extra });
  // Phones show one pane, so nothing opens beside the list there.
  const desktop = !isMobile();
  return routineMenuGroups(row, {
    nested: Boolean(props.nested),
    splits: desktop && Boolean(actions.onOpenInNewSplit),
    tabs: desktop && Boolean(actions.onOpenInNewTab) && canOpenInNewTab(),
    share: Boolean(actions.onShare),
  }).map((group) =>
    group.map((item) =>
      match(item)
        .with('open-in-split', (id) =>
          entry(
            id,
            t('entityActions.openInNewSplit'),
            () => actions.onOpenInNewSplit?.(row),
            { disabled: !actions.canOpenInNewSplit() }
          )
        )
        .with('open-in-tab', (id) =>
          entry(id, t('entityActions.openInNewTab'), () =>
            actions.onOpenInNewTab?.(row)
          )
        )
        .with('run-now', (id) =>
          entry(id, t('routineMenu.runNow'), () => actions.onRun(row), {
            disabled: !canRunRoutine(row, actions.runPending(row)),
          })
        )
        .with('turn-off', 'turn-on', (id) =>
          entry(
            id,
            id === 'turn-off'
              ? t('routineMenu.turnOff')
              : t('routineMenu.turnOn'),
            () => props.onToggle(row),
            { disabled: !canToggleRoutine(row, props.pending) }
          )
        )
        .with('duplicate', (id) =>
          entry(id, t('entityActions.duplicate'), () =>
            actions.onDuplicate(row)
          )
        )
        .with('keep', (id) =>
          entry(id, t('subRoutines.keep'), () => actions.onKeep(row))
        )
        .with('copy-link', (id) =>
          entry(id, t('entityActions.copyLink'), () => actions.onCopyLink(row))
        )
        .with('copy-id', (id) =>
          entry(id, t('entityActions.copyId'), () => actions.onCopyId(row))
        )
        .with('share', (id) =>
          entry(id, t('entityActions.share'), () => actions.onShare?.(row))
        )
        .with('delete', (id) =>
          entry(id, t('entityActions.delete'), () => actions.onDelete(row), {
            destructive: true,
          })
        )
        .exhaustive()
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
      disabled: entry.disabled,
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
      {(actions) => (
        <>
          <ContextMenu>
            <ContextMenuTrigger
              as="div"
              class="group/routine-menu"
              disabled={isMobile()}
              ref={(element: HTMLElement) =>
                touchHandler(element, () => ({ onLongPress: openDrawer }))
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
                <For each={routineMenuEntries(props, actions())}>
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
                              entry.destructive ? 'text-failure-ink' : undefined
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
              groups={drawerGroups(routineMenuEntries(props, actions()))}
              open
              onOpenChange={setDrawerOpen}
            />
          </Show>
        </>
      )}
    </Show>
  );
}
