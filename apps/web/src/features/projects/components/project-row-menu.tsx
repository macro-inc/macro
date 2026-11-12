import {
  SoupEntityActionDrawer,
  type SoupEntityDrawerActionGroup,
} from '@app/features/soup/SoupEntityActionDrawer';
import { t } from '@app/lib/i18n';
import { canOpenInNewTab } from '@components/app/tab-layout/open-in-new-tab';
import {
  ContextMenuContent,
  ContextMenuTrigger,
  CopyMenuItem,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { touchHandler } from '@core/directive/touchHandler';
import { isMobile } from '@core/mobile/isMobile';
import type { InitiativeEntity } from '@entity';
import ShareIcon from '@icon/share.svg';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import SplitIcon from '@icon/system/regular/columns.svg';
import CopyIcon from '@icon/system/regular/copy.svg';
import DotsThreeIcon from '@icon/system/regular/dots-three.svg';
import FlagIcon from '@icon/system/regular/flag.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import PaintBrushIcon from '@icon/system/regular/paint-brush.svg';
import PencilIcon from '@icon/system/regular/pencil-line.svg';
import TrashIcon from '@icon/system/regular/trash-simple.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { PropertyValueIcon } from '@property/component/propertyValue';
import type { Property } from '@property/types';
import { formatOptionValue } from '@property/utils/formatting';
import { Dropdown } from '@ui';
import {
  type Component,
  createSignal,
  For,
  type JSX,
  Match,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { match } from 'ts-pattern';
import type { ProjectRow } from '../context/projects-context';
import { type ProjectMenuItem, projectMenuGroups } from '../core/project-menu';

type ProjectMenuProps = {
  /** The projects the menu acts on, read each time it opens. */
  targets(): readonly ProjectRow[];
  /** Definitions offering the choices; their entries wait until they load. */
  status?: Property;
  priority?: Property;
  canOpenInNewSplit: boolean;
  onOpenInNewSplit(row: ProjectRow): void;
  onChangeIcon?(row: ProjectRow): void;
  /** Omit where the host cannot open a project in a new desktop tab. */
  onOpenInNewTab?(row: ProjectRow): void;
  onRename(row: ProjectRow): void;
  onSetOption(
    rows: readonly ProjectRow[],
    property: Property,
    optionId: string
  ): void;
  onCopyLink(row: ProjectRow): void | Promise<unknown>;
  onCopyId(row: ProjectRow): void | Promise<unknown>;
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
      icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
      copy?: boolean;
      run(): void | Promise<unknown>;
    }
  | {
      kind: 'options';
      id: ProjectMenuItem;
      label: string;
      property: Property;
      icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
      options: { id: string; label: string }[];
      choose(optionId: string): void;
    };

function projectMenuEntries(
  props: ProjectMenuProps,
  rows: readonly ProjectRow[]
): ProjectMenuEntry[][] {
  const single =
    (callback?: (row: ProjectRow) => void | Promise<unknown>) => () => {
      const row = rows[0];
      if (row) return callback?.(row);
    };
  const action = (
    id: ProjectMenuItem,
    label: string,
    run: () => void | Promise<unknown>,
    icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>,
    extra: {
      shortcut?: string;
      disabled?: boolean;
      destructive?: boolean;
      copy?: boolean;
    } = {}
  ): ProjectMenuEntry[] => [{ kind: 'action', id, label, run, icon, ...extra }];
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
            icon: id === 'status' ? CheckCircleIcon : FlagIcon,
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
      tabs: Boolean(props.onOpenInNewTab) && canOpenInNewTab(),
      share: Boolean(props.onShare),
      appearance: Boolean(props.onChangeIcon),
      status: Boolean(props.status),
      priority: Boolean(props.priority),
    }
  ).map((group) =>
    group.flatMap((item) =>
      match(item)
        .with('open-in-split', (id) =>
          action(
            id,
            t('entityActions.openInNewSplit'),
            single(props.onOpenInNewSplit),
            SplitIcon,
            {
              shortcut: 'shift+enter',
              // Without room for another split the open would replace this one.
              disabled: !props.canOpenInNewSplit,
            }
          )
        )
        .with('open-in-tab', (id) =>
          action(
            id,
            t('entityActions.openInNewTab'),
            single(props.onOpenInNewTab),
            ArrowSquareOutIcon
          )
        )
        .with('rename', (id) =>
          action(
            id,
            t('entityActions.rename'),
            single(props.onRename),
            PencilIcon
          )
        )
        .with('change-icon', (id) =>
          action(
            id,
            t('appearance.title'),
            single(props.onChangeIcon),
            PaintBrushIcon
          )
        )
        .with('status', (id) =>
          options(id, t('entityActions.setStatus'), props.status)
        )
        .with('priority', (id) =>
          options(id, t('entityActions.setPriority'), props.priority)
        )
        .with('copy-link', (id) =>
          action(
            id,
            t('entityActions.copyLink'),
            single(props.onCopyLink),
            LinkIcon,
            { copy: true }
          )
        )
        .with('copy-id', (id) =>
          action(
            id,
            t('entityActions.copyId'),
            single(props.onCopyId),
            CopyIcon,
            { copy: true }
          )
        )
        .with('share', (id) =>
          action(id, t('entityActions.share'), single(props.onShare), ShareIcon)
        )
        .with('delete', (id) =>
          action(
            id,
            t('entityActions.delete'),
            () => props.onDelete(rows),
            TrashIcon,
            {
              destructive: true,
            }
          )
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
              icon: entry.icon,
              copy: entry.copy,
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
                label: t('entityActions.propertyOption', {
                  property: entry.property.displayName,
                  option: option.label,
                }),
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
  appearance: row.project.appearance,
});

/**
 * A project row's actions: a right-click menu on desktop and, as for task
 * rows, a long-press drawer on mobile.
 */
export function ProjectRowMenu(
  props: ParentProps<
    ProjectMenuProps & {
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
              class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted"
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

export function ProjectMenuDropdown(props: ProjectMenuProps) {
  return (
    <Dropdown placement="bottom-start">
      <Dropdown.Trigger
        aria-label={t('entityActions.projectActions')}
        tooltip={t('entityActions.projectActions')}
        variant="ghost"
        size="icon-sm"
      >
        <DotsThreeIcon class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted">
        <Dropdown.Group>
          <ProjectMenuItems {...props} />
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function ProjectMenuItems(props: ProjectMenuProps) {
  // Freeze action targets per opening; keep available actions reactive.
  const rows = props.targets();
  const entries = () => projectMenuEntries(props, rows);
  return (
    <For each={entries()}>
      {(group, index) => (
        <>
          <Show when={index() > 0}>
            <MenuSeparator />
          </Show>
          <For each={group}>
            {(entry) =>
              match(entry)
                .with({ kind: 'action' }, (action) => (
                  <Dynamic
                    component={action.copy ? CopyMenuItem : MenuItem}
                    text={action.label}
                    icon={action.icon}
                    shortcut={action.shortcut}
                    disabled={action.disabled}
                    class={action.destructive ? 'text-failure-ink' : undefined}
                    onClick={action.run}
                    onCopy={async () => (await action.run()) !== false}
                  />
                ))
                .with({ kind: 'options' }, (entry) => (
                  <ContextMenu.Sub>
                    <SubTrigger text={entry.label} icon={entry.icon} />
                    <ContextMenuContent
                      submenu
                      class="min-w-48 max-w-[min(22rem,calc(100vw-1rem))] text-xs text-ink-muted"
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
