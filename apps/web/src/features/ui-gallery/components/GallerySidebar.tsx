import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import { Badge, InputGroup, Scroll, SideNav } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { type DocEntry, filterEntries, groupEntries } from '../registry';

export const COVERAGE_SLUG = '__coverage';

/**
 * Sections + component index. Deliberately built from `@ui` primitives so the
 * gallery dogfoods the library it documents.
 */
export function GallerySidebar(props: {
  entries: readonly DocEntry[];
  selected: string;
  onSelect: (slug: string) => void;
}) {
  const [query, setQuery] = createSignal('');
  const matches = createMemo(() => filterEntries(props.entries, query()));
  const groups = createMemo(() => groupEntries(matches()));

  return (
    <div class="w-60 shrink-0 flex flex-col border-r border-edge-muted">
      <div class="p-3 pb-2">
        <InputGroup>
          <InputGroup.Input
            type="search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search components"
            aria-label="Search components"
          />
          <InputGroup.Addon align="inline-start">
            <MagnifyingGlassIcon aria-hidden="true" />
          </InputGroup.Addon>
          <InputGroup.Addon align="inline-end">
            <InputGroup.ClearButton />
          </InputGroup.Addon>
        </InputGroup>
      </div>

      <Scroll class="flex-1 min-h-0">
        <SideNav class="w-full">
          <For each={groups()}>
            {(group) => (
              <SideNav.Group label={group.category}>
                <For each={group.entries}>
                  {(entry) => (
                    <SideNav.Item
                      active={entry.slug === props.selected}
                      onSelect={() => props.onSelect(entry.slug)}
                    >
                      {entry.doc.name}
                    </SideNav.Item>
                  )}
                </For>
              </SideNav.Group>
            )}
          </For>

          <Show when={matches().length === 0}>
            <p class="px-2 py-4 text-sm text-ink-subtle">
              No components match “{query()}”.
            </p>
          </Show>

          <SideNav.Group label="Meta">
            <SideNav.Item
              active={props.selected === COVERAGE_SLUG}
              onSelect={() => props.onSelect(COVERAGE_SLUG)}
            >
              <span class="flex items-center gap-2">
                Coverage
                <Badge variant="outline" size="sm">
                  {props.entries.length}
                </Badge>
              </span>
            </SideNav.Item>
          </SideNav.Group>
        </SideNav>
      </Scroll>
    </div>
  );
}
