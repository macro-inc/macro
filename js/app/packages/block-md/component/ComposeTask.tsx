import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { initializeEditorEmpty } from '@core/component/LexicalMarkdown/utils';
import {
  propertyApiValuesToNormalized,
  propertyValueToApi,
} from '@core/component/Properties/api/converters';
import { Modals } from '@core/component/Properties/component/modal';
import { PropertyRow } from '@core/component/Properties/component/panel';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
  usePropertiesContext,
} from '@core/component/Properties/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
  PropertyOption,
} from '@core/component/Properties/types';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { createMarkdownFile } from '@core/util/create';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import XIcon from '@icon/regular/x.svg';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { useQuery } from '@tanstack/solid-query';
import type { LexicalEditor } from 'lexical';
import { createMemo, createSignal, For, Show, Suspense } from 'solid-js';
import { createStore, reconcile, type Store } from 'solid-js/store';

export interface ComposeTaskProps {
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
}

const COMPOSER_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PRIORITY,
];

function extractPropertyValue(
  definition: PropertyDefinition,
  savedValues: Store<Record<string, PropertyApiValues>>,
  options: Map<string, PropertyOption[]>
) {
  const { type, value } = propertyApiValuesToNormalized(
    savedValues[definition.id]
  );
  if (type === 'EMPTY') return null;
  if (
    definition.data_type === 'SELECT_NUMBER' ||
    definition.data_type === 'SELECT_STRING'
  ) {
    const opts = options.get(definition.id);
    if (!opts) return null;
    if (Array.isArray(value)) {
      return filterMap(value as string[], (id) => {
        const opt = opts.find((opt) => opt.id === id);
        return opt ? opt.value.value : undefined;
      });
    }
  } else {
    return value;
  }
}

export function ComposeTask(props: ComposeTaskProps) {
  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const splitPanel = useSplitPanel();

  const [propertyValues, setPropertyValues] = createStore<
    Record<string, PropertyApiValues>
  >({});

  const systemPropertiesQuery = useQuery(() => ({
    queryKey: ['compose-task', 'system-properties'],
    queryFn: async () => {
      const result = await propertiesServiceClient.listProperties({
        scope: 'system',
        include_options: true,
      });
      if (isErr(result)) {
        throw new Error('Failed to fetch system properties');
      }
      const [, data] = result;
      return data;
    },
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 10,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
    // initialData: [],
  }));

  const definitions = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  };

  const options = () => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  };

  const properties = () => {
    return filterMap<string, Property>(COMPOSER_PROPERTIES, (id) => {
      const definition = definitions().get(id);
      if (!definition) return;
      return {
        propertyId: `compose-${definition.display_name}`,
        propertyDefinitionId: definition.id,
        displayName: definition.display_name,
        isMultiSelect: definition.is_multi_select,
        owner: definition.owner,
        specificEntityType: definition.specific_entity_type ?? null,
        updatedAt: '',
        createdAt: '',
        valueType: definition.data_type,
        value: extractPropertyValue(definition, propertyValues, options()),
      } as Property;
    });
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      setPropertyValues(property.propertyDefinitionId, value);
      return { ok: true, value: undefined };
    },
    saveDate: async (property: Property, date: Date) => {
      console.log('SAVING DATE PROP', { property, date });
      setPropertyValues(property.propertyDefinitionId, {
        valueType: 'DATE',
        value: date.toISOString(),
      });
      return { ok: true, value: undefined };
    },
  };

  const handleCreateTask = async () => {
    const taskTitle = title().trim();
    const taskContent = content().trim();

    if (taskTitle || taskContent) {
      const res = await createMarkdownFile({
        title: taskTitle,
        content: taskContent,
        isTask: true,
      });

      if (res) {
        const propertyRequests: Promise<any>[] = [];
        for (const [id, value] of Object.entries(propertyValues)) {
          const isMultiSelect = definitions().get(id)?.is_multi_select ?? false;
          propertyRequests.push(
            propertiesServiceClient.setEntityProperty({
              entity_id: res,
              entity_type: 'TASK',
              property_id: id,
              body: {
                value: propertyValueToApi(value, isMultiSelect),
              },
            })
          );
        }

        setTitle('');
        const ed = bodyEditor();
        if (ed) initializeEditorEmpty(ed);
        setPropertyValues(reconcile({}));

        if (splitPanel?.isPopover) {
          splitPanel.handle.close();
        }

        props.onCreateTask?.(taskTitle, taskContent);
        props.onClose?.();
        Promise.allSettled(propertyRequests).then(() => {
          toast.embed(
            () => {
              // TODO (seamus) : make this suck less
              return (
                <BlockLink blockOrFileName="task" id={res}>
                  <div class="">
                    <div class="flex row">
                      <EntityIcon targetType="task" />
                      <span>{taskTitle}</span>
                    </div>
                    <StaticMarkdown markdown={taskContent} />
                  </div>
                </BlockLink>
              );
            },
            {
              duration: 2000,
            }
          );
        });
      } else {
        toast.failure('Failed to create task');
      }
    }
  };

  return (
    <div class="flex flex-col gap-2 p-3 relative">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <EntityIcon targetType="task" size="sm" />
          <span class="text-sm font-medium text-ink-disabled/50">
            Create Task
          </span>
        </div>
        <Show when={splitPanel?.isPopover}>
          <IconButton
            icon={XIcon}
            onClick={splitPanel?.handle.close}
            size="sm"
            tabIndex={-1}
            theme="clear"
          />
        </Show>
      </div>
      <div class="flex-shrink-0 flex gap-2 items-center -my-1">
        <input
          type="text"
          placeholder="Task title..."
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          class="w-full py-2 text-xl font-medium placeholder-ink-placeholder/50"
        />
      </div>

      <div class="min-h-0 text-base">
        <MarkdownTextarea
          editable={() => true}
          onChange={(value) => setContent(value)}
          initialValue={props.initialContent}
          placeholder={props.placeholder ?? 'Add description...'}
          captureEditor={setBodyEditor}
        />
      </div>

      <Suspense>
        <PropertiesProvider
          entityType="TASK"
          canEdit={true}
          properties={properties}
          onRefresh={() => {}}
          onPropertyAdded={() => {}}
          onPropertyDeleted={() => {}}
          saveHandler={saveHandler}
        >
          <div class="w-full grid grid-cols-2 gap-1 flex-wrap text-xs font-mono text-ink-muted">
            <For each={properties()}>
              {(prop) => {
                const { openPropertyEditor, openDatePicker } =
                  usePropertiesContext();
                const handleValueClick = (
                  property: Property,
                  anchor?: HTMLElement
                ) => {
                  if (property.valueType === 'DATE') {
                    openDatePicker(property, anchor);
                  } else if (
                    property.valueType === 'SELECT_STRING' ||
                    property.valueType === 'SELECT_NUMBER' ||
                    property.valueType === 'ENTITY'
                  ) {
                    openPropertyEditor(property, anchor);
                  }
                };
                return (
                  <div class="grid grid-cols-[8rem_auto] rounded-xs items-center p-1">
                    <PropertyRow
                      property={prop}
                      onValueClick={handleValueClick}
                      withDelete={false}
                      withPin={false}
                    />
                  </div>
                );
              }}
            </For>
          </div>
          <Modals />
        </PropertiesProvider>
      </Suspense>

      <div class="w-full border-b border-edge-muted/50" />
      {/* Action Button */}
      <div class="flex-shrink-0 flex justify-end">
        <TextButton
          onClick={handleCreateTask}
          text="Create Task"
          theme="accent"
        />
      </div>
    </div>
  );
}
