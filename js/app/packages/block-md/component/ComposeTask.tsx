import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { propertyApiValuesToNormalized } from '@core/component/Properties/api/converters';
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
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { useQuery } from '@tanstack/solid-query';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Suspense,
} from 'solid-js';
import { createStore, type Store } from 'solid-js/store';

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
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  // SYSTEM_PROPERTY_IDS.SUBJECT,
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
        return opts.find((opt) => opt.id === id)?.value?.value ?? undefined;
      });
    }
  } else {
    return value;
  }
}

export function ComposeTask(props: ComposeTaskProps) {
  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [, setBodyEditor] = createSignal<LexicalEditor>();

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
  }));

  const definitions = createMemo<Map<string, PropertyDefinition>>(() => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        return [definition.id, definition];
      })
    );
  });

  const options = createMemo<Map<string, PropertyOption[]>>(() => {
    if (!systemPropertiesQuery.isSuccess) return new Map();
    const data = systemPropertiesQuery.data;
    return new Map(
      data.map((p) => {
        const definition = 'definition' in p ? p.definition : p;
        const options = 'property_options' in p ? p.property_options : [];
        return [definition.id, options];
      })
    );
  });

  const properties = createMemo(() => {
    return filterMap<string, Property>(COMPOSER_PROPERTIES, (id) => {
      const definition = definitions().get(id);
      if (!definition) return;

      return {
        propertyId: `compose-${definition.display_name}`,
        propertyDefinitionId: definition.id,
        displayName: definition.display_name,
        isMultiSelect: definition.is_multi_select,
        owner: definition.owner,
        updatedAt: '',
        createdAt: '',
        valueType: definition.data_type,
        value: extractPropertyValue(definition, propertyValues, options()),
      };
    });
  });

  createEffect(() => {
    console.log(properties(), options());
  });

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
        // // Apply stored property values to the newly created task
        // const storedValues = propertyValues();
        // const promises = Object.entries(storedValues).map(
        //   async ([propertyId, value]) => {
        //     const property = properties().find(
        //       (p) => p.propertyDefinitionId === propertyId
        //     );
        //     if (property) {
        //       await saveEntityProperty(
        //         res, // res is the document ID string
        //         'TASK',
        //         property,
        //         value
        //       );
        //     }
        //   }
        // );

        // try {
        //   await Promise.all(promises);
        // } catch (error) {
        //   console.error('Failed to save some properties:', error);
        //   toast.failure('Task created but some properties failed to save');
        // }

        // Reset form
        setTitle('');
        setContent('');
        setPropertyValues({});

        props.onCreateTask?.(taskTitle, taskContent);
        props.onClose?.();
      } else {
        toast.failure('Failed to create task');
      }
    }
  };

  return (
    <div class="flex flex-col gap-4 h-96 p-4 relative">
      {/* Title Input */}
      <div class="flex-shrink-0">
        <input
          type="text"
          placeholder="Task title..."
          value={title()}
          onInput={(e) => setTitle(e.currentTarget.value)}
          class="w-full py-2 text-xl font-regular placeholder-ink-placeholder"
        />
      </div>

      <div class="flex-1 min-h-0 text-base">
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
          <div class="w-full flex row gap-2">
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
                  <div class="bg-edge/20 rounded-sm flex row items-center p-1">
                    <PropertyRow
                      property={prop}
                      onValueClick={handleValueClick}
                    />
                  </div>
                );
              }}
            </For>
          </div>
          <Modals />
        </PropertiesProvider>
      </Suspense>

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
