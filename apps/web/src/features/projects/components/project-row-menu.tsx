import {
  SoupEntityActionDrawer,
  type SoupEntityDrawerActionGroup,
} from '@app/features/soup/SoupEntityActionDrawer';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { InitiativeEntity } from '@entity';
import { ContextMenu } from '@kobalte/core/context-menu';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
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
import { projectMenuGroups } from '../core/project-menu';

type SingleProjectCommand =
  | 'open-in-split'
  | 'rename'
  | 'copy-link'
  | 'copy-id'
  | 'share';

/** What a chosen entry asks the list to do. */
export type ProjectRowMenuCommand =
  | { kind: SingleProjectCommand; row: ProjectRow }
  | {
      kind: 'set-option';
      rows: readonly ProjectRow[];
      property: Property;
      optionId: string;
    }
  | { kind: 'delete'; rows: readonly ProjectRow[] };

type ProjectRowMenuProps = {
  /** The projects the menu acts on, read each time it opens. */
  targets(): readonly ProjectRow[];
  /** Definitions that supply the Status and Priority choices. */
  properties: readonly Property[];
  canOpenInNewSplit: boolean;
  canShare: boolean;
  onCommand(command: ProjectRowMenuCommand): void;
};

/** One entry, shown as a menu item on desktop and a drawer row on mobile. */
type ProjectMenuEntry =
  | {
      kind: 'action';
      id: string;
      label: string;
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      run(): void;
    }
  | {
      kind: 'options';
      id: string;
      label: string;
      property: Property;
      options: { id: string; label: string }[];
      choose(optionId: string): void;
    };

function projectMenuEntries(
  props: ProjectRowMenuProps,
  rows: readonly ProjectRow[]
): ProjectMenuEntry[][] {
  const definition = (id: string) =>
    props.properties.find((property) => property.propertyDefinitionId === id);
  const status = definition(SYSTEM_PROPERTY_IDS.STATUS);
  const priority = definition(SYSTEM_PROPERTY_IDS.PRIORITY);
  const action = (
    kind: SingleProjectCommand,
    label: string,
    extra: { shortcut?: string; disabled?: boolean } = {}
  ): ProjectMenuEntry[] => [
    {
      kind: 'action',
      id: kind,
      label,
      ...extra,
      run: () => {
        const row = rows[0];
        if (row) props.onCommand({ kind, row });
      },
    },
  ];
  // Only offered once the definition loads (see `projectMenuGroups`).
  const options = (
    label: string,
    property: Property | undefined
  ): ProjectMenuEntry[] =>
    property
      ? [
          {
            kind: 'options',
            id: property.propertyDefinitionId,
            label,
            property,
            options: (property.options ?? []).flatMap((option) =>
              option.value.type === 'string'
                ? [{ id: option.id, label: option.value.value }]
                : []
            ),
            choose: (optionId) =>
              props.onCommand({ kind: 'set-option', rows, property, optionId }),
          },
        ]
      : [];
  return projectMenuGroups(
    rows.map((row) => row.project),
    {
      splits: !isMobile(),
      share: props.canShare,
      status: Boolean(status),
      priority: Boolean(priority),
    }
  ).map((group) =>
    group.flatMap((item) =>
      match(item)
        .with('open-in-split', () =>
          action('open-in-split', 'Open in new split', {
            shortcut: 'shift+enter',
            // Without room for another split the open would replace this one.
            disabled: !props.canOpenInNewSplit,
          })
        )
        .with('rename', () => action('rename', 'Rename'))
        .with('status', () => options('Set status', status))
        .with('priority', () => options('Set priority', priority))
        .with('copy-link', () => action('copy-link', 'Copy Link'))
        .with('copy-id', () => action('copy-id', 'Copy ID'))
        .with('share', () => action('share', 'Share'))
        .with('delete', (): ProjectMenuEntry[] => [
          {
            kind: 'action',
            id: 'delete',
            label: 'Delete',
            destructive: true,
            run: () => props.onCommand({ kind: 'delete', rows }),
          },
        ])
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
  descriptionDocumentId: row.project.descriptionDocumentId,
});

/**
 * Solid delegates events from a portal to where it sits in the component
 * tree, so the row's portaled property editors would open this menu and lose
 * their native one.
 */
const ignorePortaledEvents = (
  event: Event & { currentTarget: HTMLElement }
) => {
  if (
    !(event.target instanceof Node) ||
    !event.currentTarget.contains(event.target)
  )
    event.stopPropagation();
};

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
          <ContextMenu.Trigger class="w-full">
            <div
              class="contents"
              onContextMenu={ignorePortaledEvents}
              onPointerDown={ignorePortaledEvents}
            >
              {props.children}
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenuContent
              class="w-56 text-xs text-ink-muted"
              onCloseAutoFocus={props.onCloseAutoFocus}
            >
              <ProjectMenuItems
                targets={props.targets}
                properties={props.properties}
                canOpenInNewSplit={props.canOpenInNewSplit}
                canShare={props.canShare}
                onCommand={props.onCommand}
              />
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
