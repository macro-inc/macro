import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@app/component/split-layout/components/SplitLabel';
import { seedMockDisplayNames } from '@core/user';
import { cn } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import {
  PROPERTIES_EMPTY,
  PROPERTIES_FILLED,
  PROPERTIES_METADATA,
} from '../../mocks/mockProperties';
import { Property } from '../property';
import type { PropertyApiValues, Property as PropertyT } from '../types';

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

        <Section title="Editors — interactive (click any value)">
          <EditorsDemo />
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

/**
 * Interactive editor demo. Each fixture gets a local signal so the demo
 * round-trips through save: clicking a value, picking a date, toggling a
 * checkbox, etc. visibly updates the rendered property. Console logs the
 * dispatched API values.
 */
const EditorsDemo: Component = () => {
  return (
    <div
      class="grid gap-3"
      style={{ 'grid-template-columns': 'repeat(2, minmax(0, 1fr))' }}
    >
      <For each={PROPERTIES_FILLED}>
        {(initial) => <EditorRow initial={initial} />}
      </For>
    </div>
  );
};

const EditorRow: Component<{ initial: PropertyT }> = (props) => {
  const [property, setProperty] = createSignal<PropertyT>(props.initial);

  const applyApiValue = (p: PropertyT, value: PropertyApiValues): PropertyT => {
    if (p.valueType === 'STRING' && value.valueType === 'STRING') {
      return { ...p, value: value.value };
    }
    if (p.valueType === 'NUMBER' && value.valueType === 'NUMBER') {
      return { ...p, value: value.value };
    }
    if (p.valueType === 'BOOLEAN' && value.valueType === 'BOOLEAN') {
      return { ...p, value: value.value };
    }
    if (p.valueType === 'DATE' && value.valueType === 'DATE') {
      return { ...p, value: value.value };
    }
    if (
      p.valueType === 'SELECT_STRING' &&
      value.valueType === 'SELECT_STRING'
    ) {
      return { ...p, value: value.values };
    }
    if (
      p.valueType === 'SELECT_NUMBER' &&
      value.valueType === 'SELECT_NUMBER'
    ) {
      return { ...p, value: value.values };
    }
    if (p.valueType === 'ENTITY' && value.valueType === 'ENTITY') {
      return { ...p, value: value.refs };
    }
    if (p.valueType === 'LINK' && value.valueType === 'LINK') {
      return { ...p, value: value.values };
    }
    return p;
  };

  const onSave = async (p: PropertyT, value: PropertyApiValues) => {
    console.log('[props-debug] save', {
      property: p.displayName,
      valueType: p.valueType,
      value,
    });
    setProperty((prev) => applyApiValue(prev, value));
  };

  const isInline = () => {
    const t = property().valueType;
    return t === 'STRING' || t === 'NUMBER' || t === 'BOOLEAN' || t === 'LINK';
  };

  return (
    <div class="border border-edge-muted/30 rounded p-2 flex flex-col gap-1 min-w-0">
      <div class="text-xxs text-ink-extra-muted truncate">
        {property().displayName} · {property().valueType}
      </div>
      <Property.Root property={property()} canEdit onSave={onSave}>
        <Show
          when={isInline()}
          fallback={
            <>
              <Property.EditTrigger class={buttonClass}>
                <Property.Icon property={property()} class="size-3 shrink-0" />
                <Property.Text
                  property={property()}
                  fallback={<Property.Empty label="None" />}
                />
                <Property.Caret />
              </Property.EditTrigger>
              <Property.PopoverEditor />
            </>
          }
        >
          <Property.InlineEditor />
        </Show>
      </Property.Root>
    </div>
  );
};

export default PropertyDebug;
