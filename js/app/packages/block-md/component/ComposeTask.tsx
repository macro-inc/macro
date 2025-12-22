import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { EntityIcon } from '@core/component/EntityIcon';
import { IconButton } from '@core/component/IconButton';
import { BlockLink } from '@core/component/LexicalMarkdown/component/core/BlockLink';
import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { unifiedListMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
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
import { itemToSafeName } from '@core/constant/allBlocks';
import { createMarkdownFile } from '@core/util/create';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import XIcon from '@icon/regular/x.svg';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { useQuery } from '@tanstack/solid-query';
import type { LexicalEditor } from 'lexical';
import { createSignal, For, Show, Suspense } from 'solid-js';
import { createStore, reconcile, type Store, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';

// Show these props in the composer.
const COMPOSER_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PRIORITY,
];

/**
 * Make a task and append props.
 * @param taskTitle Title string
 * @param taskContent content markdown string
 * @param properties Stored prop value map
 * @param definitions The definitions map for extra meta data
 * @returns
 */
async function createTaskWithProperties(
  taskTitle: string,
  taskContent: string,
  properties: Array<[string, PropertyApiValues]>,
  definitions: Map<string, PropertyDefinition>
) {
  const res = await createMarkdownFile({
    title: taskTitle,
    content: taskContent,
    isTask: true,
  });

  if (!res) {
    toast.failure('Failed to create Task');
    return null;
  }

  const propRequests = properties.map(([id, value]) => {
    const isMultiSelect = definitions.get(id)?.is_multi_select ?? false;
    return propertiesServiceClient.setEntityProperty({
      entity_id: res,
      entity_type: 'TASK',
      property_id: id,
      body: {
        value: propertyValueToApi(value, isMultiSelect),
      },
    });
  });

  await Promise.allSettled(propRequests);

  toast.embed(
    () => <TaskToastPreview id={res} title={taskTitle} body={taskContent} />,
    {
      duration: 2_000,
    }
  );

  return res;
}

/**
 * Helper to get display value of local property
 * @param definition The prop definition
 * @param savedValues The map of saved vals by propDef id
 * @param options The map of the options for the prop from the server
 * @returns
 */
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

/**
 * Toast preview component for successful task creation.
 * @param props
 * @returns
 */
function TaskToastPreview(props: { title: string; body: string; id: string }) {
  return (
    <BlockLink blockOrFileName="task" id={props.id}>
      <div class="text-ink size-full">
        <div class="flex row items-center gap-2 mb-4">
          <EntityIcon targetType="task" />
          <span class="text-base font-medium">
            {props.title ||
              itemToSafeName({ type: 'document', subType: 'task' })}
          </span>
        </div>
        <div class="text-ink-muted text-sm h-fit max-h-18 w-full truncate">
          <StaticMarkdown
            markdown={props.body}
            theme={unifiedListMarkdownTheme}
            singleLine
          />
        </div>
      </div>
    </BlockLink>
  );
}

export interface ComposeTaskProps {
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
}

export function ComposeTask(props: ComposeTaskProps) {
  const splitPanel = useSplitPanelOrThrow();
  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();

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
    staleTime: 1000 * 60 * 10, // TODO (seamus) Ask daniel what might make us wanna refetch this
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    placeholderData: (prev) => prev,
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
    return filterMap(COMPOSER_PROPERTIES, (id) => {
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
    const properties = structuredClone(Object.entries(unwrap(propertyValues)));

    createTaskWithProperties(taskTitle, taskContent, properties, definitions());

    setTitle('');
    setPropertyValues(reconcile({}));

    const ed = bodyEditor();
    ed && initializeEditorEmpty(ed);

    if (splitPanel?.handle.isPopover()) {
      splitPanel.handle.close();
    }

    props.onCreateTask?.(taskTitle, taskContent);
    props.onClose?.();
  };

  const editorFocusChange = (e: KeyboardEvent, dir: 1 | -1) => {
    const root = bodyEditor()?.getRootElement();
    const container = containerRef();
    if (!(root && container)) return;
    const tabbables = tabbable(container);
    const ndx = tabbables.indexOf(root);
    const next = (ndx + dir + tabbables.length) % tabbables.length;
    const elem = tabbables.at(next);
    if (elem) {
      elem.focus();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <div
      class="flex flex-col relative bracket-never"
      tabIndex={-1}
      ref={setContainerRef}
    >
      <div class="flex items-center gap-1 p-2">
        <Show when={splitPanel?.handle.isPopover()}>
          <IconButton
            icon={XIcon}
            onClick={splitPanel?.handle.close}
            size="sm"
            tabIndex={-1}
            theme="current"
          />
        </Show>
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-ink-disabled/50">
            Create Task
          </span>
        </div>
      </div>
      <div class="w-full border-b border-edge-muted/50" />
      <div class="p-2">
        <div class="flex-shrink-0 flex p-2 gap-2 items-center">
          <EntityIcon targetType="task" size="sm" />
          <input
            type="text"
            placeholder="Task Title"
            value={title()}
            onInput={(e) => setTitle(e.currentTarget.value)}
            class="w-full py-2 text-xl font-medium placeholder-ink-placeholder/50"
            on:keydown={(e) => {
              if (e.key === 'Escape') {
                const container = containerRef();
                if (container) {
                  container.focus();
                  e.stopPropagation();
                  e.preventDefault();
                }
              }
              if (e.key === 'Enter' || e.key === 'ArrowDown') {
                const editor = bodyEditor();
                if (editor) {
                  e.stopPropagation();
                  e.preventDefault();
                  editor.focus(undefined, { defaultSelection: 'rootEnd' });
                }
              }
            }}
          />
        </div>

        <div class="min-h-0 text-base m-2">
          <MarkdownTextarea
            editable={() => true}
            onChange={(value) => setContent(value)}
            initialValue={props.initialContent}
            placeholder={props.placeholder ?? 'Add description...'}
            captureEditor={setBodyEditor}
            onEscape={() => {
              containerRef()?.focus();
              return true;
            }}
            onFocusLeaveStart={(e) => editorFocusChange(e, -1)}
            onFocusLeaveEnd={(e) => editorFocusChange(e, +1)}
            portalScope={splitPanel.handle.isPopover() ? 'local' : 'block'}
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
            <div class="w-full grid grid-cols-2 gap-1 flex-wrap text-xs font-mono text-ink-muted mt-8">
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
      </div>

      <div class="w-full border-b border-edge-muted/50" />
      <div class="flex-shrink-0 flex justify-end p-2">
        <TextButton
          icon={() => <EntityIcon targetType="task" theme="monochrome" />}
          onClick={handleCreateTask}
          text="Create Task"
          theme="accent"
        />
      </div>
    </div>
  );
}
