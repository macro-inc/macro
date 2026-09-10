import PencilSimple from '@phosphor-icons/core/regular/pencil-simple.svg';
import Sliders from '@phosphor-icons/core/regular/sliders.svg';
import { TagDot } from '@property/tags/TagDot';
import { usePropertyOptionsQuery } from '@queries/properties/options';
import { useTagsQuery } from '@queries/properties/tags';
import type { NamedTool } from '@service-cognition/generated/tools/tool';
import type { PropertyOptionValue } from '@service-properties/generated/schemas/propertyOptionValue';
import { cn } from '@ui';
import { type Accessor, createMemo, For, Show } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

type ResolvedOption = { id: string; label: string; color?: string };

// Max chips shown per group before collapsing the rest into a "+N" counter.
const CHIP_LIMIT = 5;

function optionValueLabel(value: PropertyOptionValue): string {
  return value.type === 'string' ? value.value : String(value.value);
}

/**
 * Resolves option ids to labels + colors using the caller's tag sets, falling
 * back to the target definition's own options for non-tag selects (e.g. Status).
 * The definition options are only fetched when an id isn't already a known tag.
 */
function useOptionResolver(
  propertyDefinitionId: Accessor<string>,
  optionIds: Accessor<string[]>
) {
  const tagsQuery = useTagsQuery();

  const tagOptions = createMemo(() => {
    const map = new Map<string, ResolvedOption>();
    for (const set of tagsQuery.data ?? []) {
      for (const option of set.options) {
        map.set(option.id, {
          id: option.id,
          label: optionValueLabel(option.value),
          color: option.color ?? undefined,
        });
      }
    }
    return map;
  });

  const needsDefinitionOptions = createMemo(() =>
    optionIds().some((id) => !tagOptions().has(id))
  );

  const optionsQuery = usePropertyOptionsQuery(
    propertyDefinitionId,
    needsDefinitionOptions
  );

  const byId = createMemo(() => {
    const map = new Map(tagOptions());
    for (const option of optionsQuery.data ?? []) {
      if (!map.has(option.id)) {
        map.set(option.id, {
          id: option.id,
          label: optionValueLabel(option.value),
          color: option.color ?? undefined,
        });
      }
    }
    return map;
  });

  const isTagProperty = createMemo(() =>
    (tagsQuery.data ?? []).some(
      (set) => set.definition?.id === propertyDefinitionId()
    )
  );

  return { byId, isTagProperty };
}

function resolveChips(
  ids: string[],
  byId: ReadonlyMap<string, ResolvedOption>
): ResolvedOption[] {
  const chips: ResolvedOption[] = [];
  for (const id of ids) {
    const chip = byId.get(id);
    if (chip) chips.push(chip);
  }
  return chips;
}

function describeLiteralValue(
  data: NamedTool<'SetEntityProperty', 'call'>['data']
): string | undefined {
  if (data.string_value != null) return data.string_value;
  if (data.number_value != null) return String(data.number_value);
  if (data.boolean_value != null) return data.boolean_value ? 'Yes' : 'No';
  if (data.date_value != null) return data.date_value.slice(0, 10);
  if (data.link_url != null) return data.link_url;
  if (data.link_urls?.length) return data.link_urls.join(', ');
  if (data.entity_ref) return data.entity_ref.entityId.replace(/^macro\|/, '');
  if (data.entity_refs?.length) {
    return data.entity_refs
      .map((ref) => ref.entityId.replace(/^macro\|/, ''))
      .join(', ');
  }
  return undefined;
}

function OptionChip(props: {
  label: string;
  color?: string;
  removed?: boolean;
}) {
  return (
    <span
      class={cn(
        'inline-flex min-w-0 items-center gap-1',
        props.removed && 'line-through opacity-60'
      )}
    >
      <TagDot color={props.color} class="size-2" />
      <span class="truncate text-ink">{props.label}</span>
    </span>
  );
}

function OptionChips(props: { options: ResolvedOption[]; removed?: boolean }) {
  const visible = () => props.options.slice(0, CHIP_LIMIT);
  const overflow = () => props.options.length - visible().length;
  return (
    <>
      <For each={visible()}>
        {(option) => (
          <OptionChip
            label={option.label}
            color={option.color}
            removed={props.removed}
          />
        )}
      </For>
      <Show when={overflow() > 0}>
        <span class="shrink-0 text-xxs text-ink-muted">+{overflow()}</span>
      </Show>
    </>
  );
}

function PropertyToolBody(props: {
  scopeLabel: string;
  isTag: boolean;
  added: ResolvedOption[];
  removed: ResolvedOption[];
  literalValue?: string;
}) {
  const hasChips = () => props.added.length > 0 || props.removed.length > 0;
  const verb = () => {
    if (hasChips()) {
      if (props.added.length === 0) return props.isTag ? 'Untag' : 'Update';
      return props.isTag ? 'Tag' : 'Set';
    }
    return props.literalValue != null ? 'Set' : 'Update property on';
  };

  return (
    <div class="flex min-w-0 flex-1 items-center gap-1.5">
      <span class="shrink-0">
        {verb()} <span class="text-ink">{props.scopeLabel}</span>
      </span>
      <Show when={hasChips()}>
        <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <OptionChips options={props.added} />
          <Show when={props.added.length > 0 && props.removed.length > 0}>
            <span class="shrink-0 text-ink-muted">·</span>
          </Show>
          <OptionChips options={props.removed} removed />
        </div>
      </Show>
      <Show when={hasChips() ? undefined : props.literalValue}>
        {(value) => <span class="min-w-0 truncate text-ink">{value()}</span>}
      </Show>
    </div>
  );
}

const getHandler = createToolRenderer({
  name: 'GetEntityProperties',
  render: (ctx) => (
    <BaseTool icon={Sliders} renderContext={ctx.renderContext} type="call">
      Get properties for{' '}
      <span class="text-ink">{ctx.tool.data.entity_type}</span>
    </BaseTool>
  ),
});

const setHandler = createToolRenderer({
  name: 'SetEntityProperty',
  render: (ctx) => {
    const addIds = () => [
      ...(ctx.tool.data.add_option_ids ?? []),
      ...(ctx.tool.data.option_ids ?? []),
      ...(ctx.tool.data.option_id ? [ctx.tool.data.option_id] : []),
    ];
    const removeIds = () => ctx.tool.data.remove_option_ids ?? [];
    const allIds = () => [...addIds(), ...removeIds()];

    const { byId, isTagProperty } = useOptionResolver(
      () => ctx.tool.data.property_definition_id,
      allIds
    );

    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
      >
        <PropertyToolBody
          scopeLabel={ctx.tool.data.entity_type}
          isTag={isTagProperty()}
          added={resolveChips(addIds(), byId())}
          removed={resolveChips(removeIds(), byId())}
          literalValue={describeLiteralValue(ctx.tool.data)}
        />
      </BaseTool>
    );
  },
});

const bulkSetHandler = createToolRenderer({
  name: 'BulkSetEntityPropertyOptions',
  render: (ctx) => {
    const addIds = () => ctx.tool.data.add_option_ids ?? [];
    const removeIds = () => ctx.tool.data.remove_option_ids ?? [];
    const allIds = () => [...addIds(), ...removeIds()];

    const { byId, isTagProperty } = useOptionResolver(
      () => ctx.tool.data.property_definition_id,
      allIds
    );

    const count = () => ctx.tool.data.entities.length;
    const scopeLabel = () => `${count()} ${count() === 1 ? 'item' : 'items'}`;

    return (
      <BaseTool
        icon={PencilSimple}
        renderContext={ctx.renderContext}
        type="call"
      >
        <PropertyToolBody
          scopeLabel={scopeLabel()}
          isTag={isTagProperty()}
          added={resolveChips(addIds(), byId())}
          removed={resolveChips(removeIds(), byId())}
        />
      </BaseTool>
    );
  },
});

export const getEntityPropertiesHandler = getHandler;
export const setEntityPropertyHandler = setHandler;
export const bulkSetEntityPropertyOptionsHandler = bulkSetHandler;
