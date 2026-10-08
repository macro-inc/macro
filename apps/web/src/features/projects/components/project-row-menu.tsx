import {
  SoupEntityActionDrawer,
  type SoupEntityDrawerActionGroup,
} from '@app/features/soup/SoupEntityActionDrawer';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { InitiativeEntity } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { PropertyValueIcon } from '@property/component/propertyValue';
import type { Property } from '@property/types';
import { formatOptionValue } from '@property/utils/formatting';
import {
  createSignal,
  For,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { ProjectRow } from '../context/projects-context';
import { type ProjectMenuItem, projectMenuGroups } from '../core/project-menu';

type ProjectRowMenuProps = {
  /** The projects the menu acts on, read each time it opens. */
  targets(): readonly ProjectRow[];
  /** Definitions offering the choices; their entries wait until they load. */
  status?: Property;
  priority?: Property;
  canOpenInNewSplit: boolean;
  onOpenInNewSplit(row: ProjectRow): void;
  onRename(row: ProjectRow): void;
  onSetOption(
    rows: readonly ProjectRow[],
    property: Property,
    optionId: string
  ): void;
  onCopyLink(row: ProjectRow): void;
  onCopyId(row: ProjectRow): void;
  /** Omit where the host cannot show the Share menu. */
  onShare?(row: ProjectRow): void;
  onDelete(rows: readonly ProjectRow[]): void;
};

/** One entry, shown as a menu item on desktop and a drawer row on mobile. */
type ProjectMenuEntry =
  | {
      kind: 'action';
      id: ProjectMenuItem;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      run(): void;
    }
  | {
      kind: 'options';
      id: ProjectMenuItem;
      label: string;
      property: Property;
      options: { id: string; label: string }[];
      choose(optionId: string): void;
    };

function projectMenuEntries(
  props: ProjectRowMenuProps,
  rows: readonly ProjectRow[]
): ProjectMenuEntry[][] {
  const single = (callback?: (row: ProjectRow) => void) => () => {
    const row = rows[0];
    if (row) callback?.(row);
  };
  const action = (
    id: ProjectMenuItem,
    label: string,
    run: () => void,
    extra: { shortcut?: string; disabled?: boolean; destructive?: boolean } = {}
  ): ProjectMenuEntry[] => [{ kind: 'action', id, label, run, ...extra }];
  const options = (
    id: ProjectMenuItem,
    label: string,
    property: Property | undefined
  ): ProjectMenuEntry[] =>
    property
      ? [
          {
            kind: 'options',
            id,
            label,
            property,
            options: (property.options ?? []).map((option) => ({
              id: option.id,
              label: formatOptionValue(option),
            })),
            choose: (optionId) => props.onSetOption(rows, property, optionId),
          },
        ]
      : [];
  return projectMenuGroups(
    rows.map((row) => row.project),
    {
      splits: !isMobile(),
      share: Boolean(props.onShare),
      status: Boolean(props.status),
      priority: Boolean(props.priority),
    }
  ).map((group) =>
    group.flatMap((item) =>
      match(item)
        .with('open-in-split', (id) =>
          action(id, 'Open in new split', single(props.onOpenInNewSplit), {
            shortcut: 'shift+enter',
            // Without room for another split the open would replace this one.
            disabled: !props.canOpenInNewSplit,
          })
        )
        .with('rename', (id) => action(id, 'Rename', single(props.onRename)))
        .with('status', (id) => options(id, 'Set status', props.status))
        .with('priority', (id) => options(id, 'Set priority', props.priority))
        .with('copy-link', (id) =>
          action(id, 'Copy Link', single(props.onCopyLink))
        )
        .with('copy-id', (id) => action(id, 'Copy ID', single(props.onCopyId)))
        .with('share', (id) => action(id, 'Share', single(props.onShare)))
        .with('delete', (id) =>
          action(id, 'Delete', () => props.onDelete(rows), {
            destructive: true,
          })
        )
        .exhaustive()
    )
  );
}

/** A drawer has no submenus, so each option becomes its own row. */
function drawerGroups(
  entries: ProjectMenuEntry[][]
): SoupEntityDrawerActionGroup[] {
  return entries.flatMap((group) => {
    const actions = group.flatMap((entry) =>
      entry.kind === 'action'
        ? [
            {
              id: entry.id,
              label: entry.label,
              disabled: entry.disabled,
              destructive: entry.destructive,
              onClick: entry.run,
            },
          ]
        : []
    );
    const options = group.flatMap((entry) =>
      entry.kind === 'options'
        ? [
            {
              items: entry.options.map((option) => ({
                id: `${entry.id}:${option.id}`,
                label: `${entry.property.displayName}: ${option.label}`,
                onClick: () => entry.choose(option.id),
              })),
            },
          ]
        : []
    );
    return actions.length > 0 ? [{ items: actions }, ...options] : options;
  });
}

/** The drawer header shows the project like any other entity. */
const initiativeEntity = (row: ProjectRow): InitiativeEntity => ({
  type: 'initiative',
  id: row.project.id,
  name: row.project.name,
  ownerId: '',
});

/**
 * A project row's actions: a right-click menu on desktop and, as for task
 * rows, a long-press drawer on mobile.
 */
export function ProjectRowMenu(
  props: ParentProps<
    ProjectRowMenuProps & {
      onOpenChange(open: boolean): void;
      onCloseAutoFocus?(event: Event): void;
    }
  >
) {
  const [drawerRows, setDrawerRows] = createSignal<readonly ProjectRow[]>();
  return (
    <Switch>
      <Match when={isMobile()}>
        <div
          class="w-full"
          ref={(element) =>
            touchHandler(element, () => ({
              onLongPress: () => {
                props.onOpenChange(true);
                setDrawerRows(props.targets());
              },
            }))
          }
        >
          {props.children}
        </div>
        <Show when={drawerRows()}>
          {(rows) => {
            const [row, ...rest] = rows();
            return (
              <SoupEntityActionDrawer
                entity={
                  row && rest.length === 0 ? initiativeEntity(row) : undefined
                }
                groups={drawerGroups(projectMenuEntries(props, rows()))}
                open
                onOpenChange={(open) => {
                  if (!open) setDrawerRows(undefined);
                }}
              />
            );
          }}
        </Show>
      </Match>
      <Match when={true}>
        <ContextMenu onOpenChange={props.onOpenChange}>
          <ContextMenuTrigger class="w-full">
            {props.children}
          </ContextMenuTrigger>
          <ContextMenu.Portal>
            <ContextMenuContent
              class="w-56 text-xs text-ink-muted"
              onCloseAutoFocus={props.onCloseAutoFocus}
            >
              <ProjectMenuItems {...props} />
            </ContextMenuContent>
          </ContextMenu.Portal>
        </ContextMenu>
      </Match>
    </Switch>
  );
}

function ProjectMenuItems(props: ProjectRowMenuProps) {
  // Mounted per opening, so the entries match the rows they act on.
  const entries = projectMenuEntries(props, props.targets());
  return (
    <For each={entries}>
      {(group, index) => (
        <>
          <Show when={index() > 0}>
            <MenuSeparator />
          </Show>
          <For each={group}>
            {(entry) =>
              match(entry)
                .with({ kind: 'action' }, (action) => (
                  <MenuItem
                    text={action.label}
                    shortcut={action.shortcut}
                    disabled={action.disabled}
                    class={action.destructive ? 'text-failure-ink' : undefined}
                    onClick={action.run}
                  />
                ))
                .with({ kind: 'options' }, (entry) => (
                  <ContextMenu.Sub>
                    <SubTrigger text={entry.label} />
                    <ContextMenuContent
                      submenu
                      class="w-48 text-xs text-ink-muted"
                    >
                      <For each={entry.options}>
                        {(option) => (
                          <MenuItem
                            text={option.label}
                            icon={(icon) => (
                              <PropertyValueIcon
                                optionId={option.id}
                                class={icon.class}
                              />
                            )}
                            onClick={() => entry.choose(option.id)}
                          />
                        )}
                      </For>
                    </ContextMenuContent>
                  </ContextMenu.Sub>
                ))
                .exhaustive()
            }
          </For>
        </>
      )}
    </For>
  );
}
