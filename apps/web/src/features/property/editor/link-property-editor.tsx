import type { ListNavActions } from '@core/util/useListKeyBindings';
import CircleDashedEmpty from '@icon/system/regular/circle-dashed.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import {
  CommandMenuEmptyState,
  CommandMenuList,
  createCommandListController,
} from '@ui';
import type { Result } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createMemo,
  Match,
  on,
  type Setter,
  Show,
  Switch,
} from 'solid-js';
import type {
  Property,
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '../types';
import {
  addLinkValue,
  type LinkValueError,
  linkValueErrorMessage,
  normalizeLinkInput,
  removeLinkValue,
} from '../utils/linkValues';
import { PropertyDataTypeIcon } from '../utils/PropertyDataTypeIcon';

type LinkPropertyRow =
  | { type: 'set'; url: string; next: Result<string[], LinkValueError> }
  | { type: 'link'; url: string }
  | { type: 'clear' };

/**
 * Sets, replaces, removes and clears a Link property's links from the property
 * editor's search field, with the property row's validation and value shape.
 */
export function LinkPropertyEditor(props: {
  property: Property | PropertyDefinitionDomain;
  searchValue: Accessor<string>;
  selectedIndex: Accessor<number>;
  setSelectedIndex: Setter<number>;
  onSave: (
    apiValues: PropertyApiValues,
    event?: KeyboardEvent | MouseEvent
  ) => void;
  setKeybindings: (binding: ListNavActions) => void;
  setPlaceholder: Setter<string>;
  selectedEntityCount: number;
}) {
  // Only one item's links can be listed. For several items a typed link
  // replaces each item's value, as the select and entity editors do.
  const links = (): string[] => {
    const property = props.property;
    if (props.selectedEntityCount !== 1) return [];
    if (!('value' in property) || property.valueType !== 'LINK') return [];
    return property.value ?? [];
  };

  createEffect(() => {
    props.setPlaceholder(`Enter URL for ${props.property.displayName}`);
  });

  createEffect(
    on(props.searchValue, () => props.setSelectedIndex(0), { defer: true })
  );

  const rows = createMemo((): LinkPropertyRow[] => {
    const typed = props.searchValue().trim();
    const nextRows: LinkPropertyRow[] = [];

    if (typed) {
      nextRows.push({
        type: 'set',
        url: normalizeLinkInput(typed),
        next: addLinkValue(links(), typed, props.property.isMultiSelect),
      });
    }

    for (const url of links()) nextRows.push({ type: 'link', url });
    if (links().length > 1) nextRows.push({ type: 'clear' });

    return nextRows;
  });

  const saveLinks = (
    values: string[] | null,
    event?: KeyboardEvent | MouseEvent
  ) => {
    props.onSave({ valueType: 'LINK', values }, event);
  };

  const selectRow = (
    row: LinkPropertyRow,
    event?: KeyboardEvent | MouseEvent
  ) => {
    if (row.type === 'set') {
      if (row.next.isOk()) saveLinks(row.next.value, event);
      return;
    }

    if (row.type === 'link') {
      saveLinks(removeLinkValue(links(), row.url), event);
      return;
    }

    saveLinks(null, event);
  };

  const listController = createCommandListController({
    items: rows,
    selectedIndex: props.selectedIndex,
    setSelectedIndex: props.setSelectedIndex,
  });

  props.setKeybindings({
    select: (event) => {
      const row = rows()[props.selectedIndex()];
      if (row) selectRow(row, event);
    },
    next: () => {
      listController.selectNext();
    },
    previous: () => {
      listController.selectPrevious();
    },
  });

  const addsToLinks = () => props.property.isMultiSelect && links().length > 0;

  return (
    <Show
      when={rows().length > 0}
      fallback={
        <CommandMenuEmptyState>Type or paste a URL</CommandMenuEmptyState>
      }
    >
      <CommandMenuList
        items={rows()}
        selectedIndex={props.selectedIndex()}
        scrollSelectedIntoView={listController.shouldScrollSelectedIntoView()}
        itemId={(_, index) => `property-value-option-${index}`}
        itemDisabled={(row) => row.type === 'set' && row.next.isErr()}
        onSelect={(row, _, event) => selectRow(row, event)}
        onItemMouseMove={(index) =>
          listController.setSelectedIndexFromPointer(index)
        }
      >
        {(row) => (
          <Switch>
            <Match when={row.type === 'set' && row}>
              {(setRow) => (
                <>
                  <PropertyDataTypeIcon
                    property={props.property}
                    class="opacity-50"
                  />
                  <Show
                    when={setRow().next.match(
                      () => undefined,
                      linkValueErrorMessage
                    )}
                    fallback={
                      <span class="min-w-0 flex-1 truncate text-left text-sm font-medium">
                        <Show
                          when={addsToLinks()}
                          fallback={`Set ${props.property.displayName} to `}
                        >
                          {'Add '}
                        </Show>
                        <span class="text-ink-muted">{setRow().url}</span>
                      </span>
                    }
                  >
                    {(message) => (
                      <span class="min-w-0 flex-1 truncate text-left text-sm text-failure-ink">
                        {message()}
                      </span>
                    )}
                  </Show>
                </>
              )}
            </Match>
            <Match when={row.type === 'link' && row}>
              {(linkRow) => (
                <>
                  <LinkIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="min-w-0 flex-1 truncate text-left text-sm">
                    {linkRow().url}
                  </span>
                  <span class="shrink-0 text-xs text-ink-muted">Remove</span>
                </>
              )}
            </Match>
            <Match when={row.type === 'clear'}>
              <CircleDashedEmpty class="size-4 text-ink-muted opacity-50" />
              <span class="min-w-0 flex-1 truncate text-left text-ink-muted">
                Clear all {props.property.displayName.toLowerCase()}
              </span>
            </Match>
          </Switch>
        )}
      </CommandMenuList>
    </Show>
  );
}
