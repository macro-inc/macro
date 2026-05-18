import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { seedMockDisplayNames } from '@core/user';
import { cn } from '@ui';
import { type Component, For, type JSX, Show } from 'solid-js';
import {
  PROPERTIES_EMPTY,
  PROPERTIES_FILLED,
  PROPERTIES_METADATA,
} from '../../mocks/mockProperties';
import { Property } from '../property';
import type { Property as PropertyT } from '../types';

// Seed mock display names so user properties render real first names.
seedMockDisplayNames([
  { id: 'macro|alex@example.com', firstName: 'Alex', lastName: 'Owner' },
  { id: 'macro|sam@example.com', firstName: 'Sam', lastName: 'Shared' },
  { id: 'macro|jordan@example.com', firstName: 'Jordan', lastName: 'Team' },
  { id: 'macro|current@example.com', firstName: 'Current', lastName: 'User' },
]);

const Section: Component<{ title: string; children: JSX.Element }> = (
  props
) => (
  <section class="border border-edge-muted rounded p-4 flex flex-col gap-3">
    <h2 class="text-sm font-mono text-ink-muted">{props.title}</h2>
    {props.children}
  </section>
);

const Cell: Component<{ label: string; children: JSX.Element }> = (props) => (
  <div class="flex flex-col gap-1 min-w-0">
    <div class="text-xxs text-ink-extra-muted uppercase tracking-wide">
      {props.label}
    </div>
    <div class="min-w-0">{props.children}</div>
  </div>
);

const Grid: Component<{
  title: string;
  properties: PropertyT[];
  children: (p: PropertyT) => JSX.Element;
}> = (props) => (
  <div>
    <div class="text-xs text-ink-muted mb-2">{props.title}</div>
    <div
      class="grid gap-3"
      style={{ 'grid-template-columns': 'repeat(4, minmax(0, 1fr))' }}
    >
      <For each={props.properties}>
        {(p) => (
          <div class="border border-edge-muted/30 rounded p-2 flex flex-col gap-1 min-w-0">
            <div class="text-xxs text-ink-extra-muted truncate">
              {p.displayName} · {p.valueType}
            </div>
            <div class="min-w-0">{props.children(p)}</div>
          </div>
        )}
      </For>
    </div>
  </div>
);

const buttonClass = cn(
  'inline-flex items-center gap-1 min-w-0',
  'px-2 py-1 leading-tight text-left rounded-sm hover:bg-hover'
);

/**
 * Debug surface for the @property primitives. Mirrors the entity debug view:
 * exhaustively renders each extractor and composed assembly against mock
 * properties with no network. Save handler logs to console and updates local
 * state so editing affordances are testable.
 *
 * Mounted at /props-debug via componentRegistry (LOCAL_ONLY).
 */
const PropertyDebug: Component = () => {
  // For now the demo renders straight from the fixtures. A future enhancement
  // could make edits round-trip through a local store so save/clear visibly
  // mutate state.
  const get = (p: PropertyT) => p;

  const onSave = async (p: PropertyT, value: unknown) => {
    console.log('[props-debug] save', {
      property: p.displayName,
      valueType: p.valueType,
      value,
    });
    // No-op locally: in a real consumer the property accessor would refetch.
    // For the debug page we just keep the original value so the demo stays
    // visually stable across clicks.
  };

  const onEdit = (p: PropertyT) => {
    console.log('[props-debug] open editor', {
      property: p.displayName,
      valueType: p.valueType,
    });
  };

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Property Component Demo" />
      </SplitHeaderLeft>
      <div class="size-full overflow-auto p-4 flex flex-col gap-4">
        <Section title="Primitives — filled (canEdit=true)">
          <Grid title="Property.Text + fallback" properties={PROPERTIES_FILLED}>
            {(p) => (
              <Property.Root
                property={get(p)}
                canEdit
                onSave={onSave}
                onEdit={onEdit}
              >
                <Property.Text
                  property={get(p)}
                  fallback={<Property.Empty label="None" />}
                />
              </Property.Root>
            )}
          </Grid>
          <Grid
            title="Property.Icon + Property.Text"
            properties={PROPERTIES_FILLED}
          >
            {(p) => (
              <Property.Root
                property={get(p)}
                canEdit
                onSave={onSave}
                onEdit={onEdit}
              >
                <div class="inline-flex items-center gap-1.5 min-w-0">
                  <Property.Icon property={get(p)} class="size-3 shrink-0" />
                  <Property.Text
                    property={get(p)}
                    fallback={<Property.Empty label="None" />}
                  />
                </div>
              </Property.Root>
            )}
          </Grid>
        </Section>

        <Section title="Primitives — empty">
          <Grid
            title="Property.Text with fallback"
            properties={PROPERTIES_EMPTY}
          >
            {(p) => (
              <Property.Root
                property={get(p)}
                canEdit
                onSave={onSave}
                onEdit={onEdit}
              >
                <Property.Text
                  property={get(p)}
                  fallback={
                    <Property.Empty
                      label={`Set ${p.displayName.toLowerCase()}`}
                    />
                  }
                />
              </Property.Root>
            )}
          </Grid>
        </Section>

        <Section title="Primitives — read-only (isMetadata)">
          <Grid
            title="No edit affordances should render"
            properties={PROPERTIES_METADATA}
          >
            {(p) => (
              <Property.Root
                property={get(p)}
                canEdit
                onSave={onSave}
                onEdit={onEdit}
              >
                <div class="inline-flex items-center gap-1.5">
                  <Property.Icon property={get(p)} class="size-3 shrink-0" />
                  <Property.Text property={get(p)} />
                  <Property.Caret />
                </div>
              </Property.Root>
            )}
          </Grid>
        </Section>

        <Section title="Compositions — inline pill (like InlinePropertyValue)">
          <Grid
            title="Tooltip + EditTrigger + Icon + Text + Caret"
            properties={PROPERTIES_FILLED}
          >
            {(p) => (
              <Property.Root
                property={get(p)}
                canEdit
                onSave={onSave}
                onEdit={onEdit}
              >
                <Property.Tooltip property={get(p)}>
                  <Property.EditTrigger class={buttonClass}>
                    <Property.Icon property={get(p)} class="size-3 shrink-0" />
                    <Property.Text
                      property={get(p)}
                      fallback={<Property.Empty label="None" />}
                    />
                    <Property.Caret />
                  </Property.EditTrigger>
                </Property.Tooltip>
              </Property.Root>
            )}
          </Grid>
        </Section>

        <Section title="Compositions — user stack (ENTITY+USER)">
          <Cell label="Single & multi users">
            <div class="flex gap-4">
              <For
                each={PROPERTIES_FILLED.filter(
                  (p) =>
                    p.valueType === 'ENTITY' && p.specificEntityType === 'USER'
                )}
              >
                {(p) => (
                  <Property.Root
                    property={get(p)}
                    canEdit
                    onSave={onSave}
                    onEdit={onEdit}
                  >
                    <div class="inline-flex items-center gap-2">
                      <Property.UserStack property={get(p)} maxUsers={2} />
                      <Property.Text property={get(p)} />
                    </div>
                  </Property.Root>
                )}
              </For>
            </div>
          </Cell>
        </Section>

        <Section title="Compositions — chips (multi-select / non-user entity / link)">
          <For
            each={PROPERTIES_FILLED.filter(
              (p) =>
                (p.valueType === 'SELECT_STRING' && p.isMultiSelect) ||
                p.valueType === 'LINK' ||
                (p.valueType === 'ENTITY' && p.specificEntityType !== 'USER')
            )}
          >
            {(p) => (
              <Cell label={`${p.displayName} · ${p.valueType}`}>
                <Property.Root
                  property={get(p)}
                  canEdit
                  onSave={onSave}
                  onEdit={onEdit}
                >
                  <Property.Chips property={get(p)} />
                </Property.Root>
              </Cell>
            )}
          </For>
        </Section>

        <Section title="Composed (stubs — coming in PR 3-6)">
          <Show when={true} fallback={null}>
            <div class="text-xs text-ink-muted">
              CondensedProperty / InlineProperty / ListProperty / PanelRow will
              land here as their corresponding migration PRs go in.
            </div>
          </Show>
        </Section>
      </div>
    </>
  );
};

export default PropertyDebug;
