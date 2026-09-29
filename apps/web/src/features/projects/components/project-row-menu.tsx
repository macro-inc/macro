import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import { isMobile } from '@core/mobile/isMobile';
import { ContextMenu } from '@kobalte/core/context-menu';
import { PropertyValueIcon } from '@property/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property } from '@property/types';
import { For, type ParentProps, Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ProjectRow } from '../context/projects-context';
import { type ProjectMenuItem, projectMenuGroups } from '../core/project-menu';

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

/** A project row's right-click menu, built from the shared context-menu items. */
export function ProjectRowMenu(
  props: ParentProps<
    ProjectRowMenuProps & {
      onOpenChange(open: boolean): void;
      onCloseAutoFocus?(event: Event): void;
    }
  >
) {
  return (
    <ContextMenu onOpenChange={props.onOpenChange}>
      <ContextMenu.Trigger class="w-full">{props.children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenuContent
          class="w-56 text-xs text-ink-muted"
          onCloseAutoFocus={props.onCloseAutoFocus}
        >
          <ProjectRowMenuItems
            targets={props.targets}
            properties={props.properties}
            canOpenInNewSplit={props.canOpenInNewSplit}
            canShare={props.canShare}
            onCommand={props.onCommand}
          />
        </ContextMenuContent>
      </ContextMenu.Portal>
    </ContextMenu>
  );
}

function ProjectRowMenuItems(props: ProjectRowMenuProps) {
  // Mounted per opening, so the entries match the rows they act on.
  const rows = props.targets();
  const groups = () =>
    projectMenuGroups(
      rows.map((row) => row.project),
      { splits: !isMobile(), share: props.canShare }
    );
  const single = (kind: SingleProjectCommand) => {
    const row = rows[0];
    if (row) props.onCommand({ kind, row });
  };
  const choose = (property: Property, optionId: string) =>
    props.onCommand({ kind: 'set-option', rows, property, optionId });
  const definition = (id: string) =>
    props.properties.find((property) => property.propertyDefinitionId === id);

  const entry = (item: ProjectMenuItem) =>
    match(item)
      .with('open-in-split', () => (
        <MenuItem
          text="Open in new split"
          shortcut="shift+enter"
          // Without room for another split the open would replace this one.
          disabled={!props.canOpenInNewSplit}
          onClick={() => single('open-in-split')}
        />
      ))
      .with('rename', () => (
        <MenuItem text="Rename" onClick={() => single('rename')} />
      ))
      .with('status', () => (
        <OptionSubmenu
          text="Set status"
          property={definition(SYSTEM_PROPERTY_IDS.STATUS)}
          onSelect={choose}
        />
      ))
      .with('priority', () => (
        <OptionSubmenu
          text="Set priority"
          property={definition(SYSTEM_PROPERTY_IDS.PRIORITY)}
          onSelect={choose}
        />
      ))
      .with('copy-link', () => (
        <MenuItem text="Copy Link" onClick={() => single('copy-link')} />
      ))
      .with('copy-id', () => (
        <MenuItem text="Copy ID" onClick={() => single('copy-id')} />
      ))
      .with('share', () => (
        <MenuItem text="Share" onClick={() => single('share')} />
      ))
      .with('delete', () => (
        <MenuItem
          text="Delete"
          class="text-failure-ink"
          onClick={() => props.onCommand({ kind: 'delete', rows })}
        />
      ))
      .exhaustive();

  return (
    <For each={groups()}>
      {(group, index) => (
        <>
          <Show when={index() > 0}>
            <MenuSeparator />
          </Show>
          <For each={group}>{entry}</For>
        </>
      )}
    </For>
  );
}

/** A select property's options, hidden until its definition has loaded. */
function OptionSubmenu(props: {
  text: string;
  property: Property | undefined;
  onSelect(property: Property, optionId: string): void;
}) {
  return (
    <Show when={props.property}>
      {(property) => (
        <ContextMenu.Sub>
          <SubTrigger text={props.text} />
          <ContextMenuContent submenu class="w-48 text-xs text-ink-muted">
            <For
              each={(property().options ?? []).flatMap((option) =>
                option.value.type === 'string'
                  ? [{ id: option.id, label: option.value.value }]
                  : []
              )}
            >
              {(option) => (
                <MenuItem
                  text={option.label}
                  icon={(icon) => (
                    <PropertyValueIcon
                      optionId={option.id}
                      class={icon.class}
                    />
                  )}
                  onClick={() => props.onSelect(property(), option.id)}
                />
              )}
            </For>
          </ContextMenuContent>
        </ContextMenu.Sub>
      )}
    </Show>
  );
}
