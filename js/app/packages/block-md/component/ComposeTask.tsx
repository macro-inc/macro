import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { EntityIcon } from '@core/component/EntityIcon';
import { MiniToggleSwitch } from '@core/component/FormControls/MiniToggleSwitch';
import { Hotkey } from '@core/component/Hotkey';
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
import { PropertyGrid } from '@core/component/Properties/component/panel';
import {
  PROPERTY_OPTION_IDS,
  SYSTEM_PROPERTY_IDS,
} from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@core/component/Properties/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
  PropertyOption,
} from '@core/component/Properties/types';
import { toast } from '@core/component/Toast/Toast';
import { itemToSafeName } from '@core/constant/allBlocks';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createTask } from '@core/util/create';
import { filterMap } from '@core/util/list';
import { isErr } from '@core/util/maybeResult';
import { buildSimpleEntityUrl } from '@core/util/url';
import LinkIcon from '@icon/regular/link-simple.svg';
import TrashIcon from '@icon/regular/trash.svg';
import XIcon from '@icon/regular/x.svg';
import {
  queryKeys,
  useQueryClient as useEntityQueryClient,
} from '@macro-entity';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { useUserId } from '@queries/auth/user-info';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { debounce } from '@solid-primitives/scheduled';
import { useQuery } from '@tanstack/solid-query';
import { Button } from '@ui/components/Button';
import type { LexicalEditor } from 'lexical';
import { createEffect, createSignal, onMount, Show, Suspense } from 'solid-js';
import { createStore, reconcile, type Store, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  updateDraftTimestamp,
} from '../util/taskComposerStorage';

// Show these props in the composer.
const COMPOSER_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
  SYSTEM_PROPERTY_IDS.PRIORITY,
];

/**
 * Make a task and append props using the create_task endpoint.
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
  definitions: Map<string, PropertyDefinition>,
  upsertToHistory: (params: { itemId: string; itemType: 'document' }) => void
) {
  // Convert properties to API format (filter out null values)
  const propertyValues = properties.flatMap(([id, value]) => {
    const isMultiSelect = definitions.get(id)?.is_multi_select ?? false;
    const apiValue = propertyValueToApi(value, isMultiSelect);
    if (apiValue === null) return [];
    return [{ propertyId: id, value: apiValue }];
  });

  const documentId = await createTask({
    title: taskTitle,
    content: taskContent,
    propertyValues: propertyValues.length > 0 ? propertyValues : undefined,
  });

  if (!documentId) {
    toast.failure('Failed to create Task');
    return null;
  }

  toast.embed(
    () => (
      <TaskToastPreview id={documentId} title={taskTitle} body={taskContent} />
    ),
    {
      duration: 2_000,
    }
  );

  // Invalidate queries to refresh DSS and add to history
  const entityQueryClient = useEntityQueryClient();
  entityQueryClient.invalidateQueries({
    queryKey: queryKeys.all.dss,
  });

  // Upsert the new task to history
  upsertToHistory({
    itemId: documentId,
    itemType: 'document',
  });

  return documentId;
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
        return opt ? opt.id : undefined;
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
  const [linkCopied, setLinkCopied] = createSignal(false);
  onMount(() => {
    try {
      const url = buildSimpleEntityUrl(
        {
          type: 'task',
          id: props.id,
        },
        {}
      );
      navigator.clipboard.writeText(url);
      setLinkCopied(true);
    } finally {
    }
  });

  return (
    <BlockLink blockOrFileName="task" id={props.id}>
      <div class="text-ink size-full w-96">
        <div class="flex row items-center gap-2 mb-4">
          <EntityIcon targetType="task" />
          <span class="text-base font-medium">
            {props.title ||
              itemToSafeName({
                type: 'document',
                subType: { type: 'task' },
              })}
          </span>
        </div>
        <div class="text-ink-muted text-sm h-fit max-h-18 w-full truncate">
          <StaticMarkdown
            markdown={props.body}
            theme={unifiedListMarkdownTheme}
            singleLine
          />
        </div>
        <Show when={linkCopied()}>
          <div class="text-xs flex items-center gap-2 bg-success-bg text-success-ink rounded-sm mt-2 p-1">
            <LinkIcon class="size-4" />
            Link Copied to Clipboard
          </div>
        </Show>
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
  const currentUserId = useUserId();

  const getDefaultPropertyValues = (): Record<string, PropertyApiValues> => {
    const id = currentUserId();
    return {
      [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
        valueType: 'ENTITY' as const,
        refs: id ? [{ entity_id: id, entity_type: 'USER' as const }] : [],
      },
      [SYSTEM_PROPERTY_IDS.STATUS]: {
        valueType: 'SELECT_STRING' as const,
        values: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
      },
    };
  };

  // draft init logic
  const initializeFromDraft = () => {
    if (!props.initialTitle && !props.initialContent) {
      const draft = loadTaskComposerDraft();
      if (draft) {
        return {
          title: draft.title,
          content: draft.content,
          propertyValues: draft.propertyValues,
          isDraftLoaded: true,
        };
      }
    }
    return {
      title: props.initialTitle ?? '',
      content: props.initialContent ?? '',
      propertyValues: getDefaultPropertyValues(),
      isDraftLoaded: false,
    };
  };

  const initialState = initializeFromDraft();
  const [title, setTitle] = createSignal(initialState.title);
  const [content, setContent] = createSignal(initialState.content);
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [attachHotkeys, composeHotkeyScope] = useHotkeyDOMScope(
    'compose-task',
    true
  );
  const [isDraftLoaded, setIsDraftLoaded] = createSignal(
    initialState.isDraftLoaded
  );
  const [createMore, setCreateMore] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string>('');

  const [propertyValues, setPropertyValues] = createStore<
    Record<string, PropertyApiValues>
  >(initialState.propertyValues);

  // History upsert mutation
  const upsertToHistoryMutation = useUpsertToHistoryMutation();

  // draft saving logic
  let hasInitializedFromDraft = isDraftLoaded();
  const debouncedSave = debounce(saveTaskComposerDraft, 300);

  createEffect(() => {
    const currentTitle = title();
    const currentContent = content();
    const currentProperties = { ...unwrap(propertyValues) };

    if (hasInitializedFromDraft) {
      hasInitializedFromDraft = false;
      return;
    }

    debouncedSave({
      title: currentTitle,
      content: currentContent,
      propertyValues: currentProperties,
    });
  });

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
        options: options().get(definition.id),
      } as Property;
    });
  };

  const saveHandler: PropertySaveHandler = {
    saveProperty: async (property: Property, value: PropertyApiValues) => {
      setPropertyValues(property.propertyDefinitionId, value);
    },
    saveDate: async (property: Property, date: Date) => {
      setPropertyValues(property.propertyDefinitionId, {
        valueType: 'DATE',
        value: date.toISOString(),
      });
    },
  };

  const handleCreateTask = async () => {
    const taskTitle = title().trim();
    const taskContent = content().trim();

    if (!taskTitle) {
      setErrorMessage('Please give this task a title');
      return;
    }
    setErrorMessage('');

    const properties = structuredClone(Object.entries(unwrap(propertyValues)));

    createTaskWithProperties(
      taskTitle,
      taskContent,
      properties,
      definitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );

    // Clear draft and reset form
    clearTaskComposerDraft();
    setTitle('');
    setContent('');
    setPropertyValues(reconcile(getDefaultPropertyValues()));
    setIsDraftLoaded(false);

    const ed = bodyEditor();
    ed && initializeEditorEmpty(ed);

    if (!createMore()) {
      splitPanel.handle.close();
      props.onCreateTask?.(taskTitle, taskContent);
      props.onClose?.();
    } else {
      props.onCreateTask?.(taskTitle, taskContent);
    }
  };

  const handleClose = () => {
    const currentTitle = title();
    const currentContent = content();

    if (currentTitle || currentContent) {
      updateDraftTimestamp();
    }
    splitPanel.handle.close();
    props.onClose?.();
  };

  const handleClearDraft = () => {
    clearTaskComposerDraft();
    setTitle('');
    setContent('');
    setPropertyValues(reconcile(getDefaultPropertyValues()));
    setIsDraftLoaded(false);
    const ed = bodyEditor();
    ed && initializeEditorEmpty(ed);
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

  onMount(() => {
    const container = containerRef();
    if (container) {
      attachHotkeys(container);
    }
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composeHotkeyScope,
    description: 'Create task',
    keyDownHandler: () => {
      handleCreateTask();
      return true;
    },
    runWithInputFocused: true,
  });

  return (
    <div
      class="flex flex-col relative bracket-never"
      tabIndex={-1}
      ref={setContainerRef}
    >
      <div class="flex items-center gap-1 p-2">
        <Show when={splitPanel?.handle.isPopover()}>
          <DeprecatedIconButton
            icon={XIcon}
            onClick={handleClose}
            size="sm"
            tabIndex={-1}
            theme="current"
          />
        </Show>
        <div class="flex items-center gap-2 flex-1">
          <span class="text-sm font-medium text-ink-disabled/50">
            Create Task
          </span>
        </div>
        <Show when={title() || content()}>
          <DeprecatedIconButton
            icon={TrashIcon}
            onClick={handleClearDraft}
            size="sm"
            tabIndex={-1}
            theme="current"
            title="Clear draft"
          />
        </Show>
      </div>
      <div class="w-full border-b border-edge-muted/50" />
      <div class="p-2">
        <div class="flex-shrink-0 flex p-2 gap-2 items-center">
          <EntityIcon targetType="task" size="sm" />
          <input
            type="text"
            placeholder="Task Title"
            value={title()}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              if (errorMessage()) {
                setErrorMessage('');
              }
            }}
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
            initialValue={content()}
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
            <div class="text-sm">
              <PropertyGrid
                properties={properties()}
                columns={2}
              ></PropertyGrid>
              <Modals />
            </div>
          </PropertiesProvider>
        </Suspense>
      </div>

      <Show when={errorMessage()}>
        <div class="w-full border-b border-edge-muted/50" />
        <div class="px-2 py-2">
          <div class="text-sm text-failure-ink px-3 py-2">{errorMessage()}</div>
        </div>
      </Show>

      <div class="w-full border-b border-edge-muted/50" />
      <div class="flex-shrink-0 flex justify-between items-center p-2 gap-2">
        <MiniToggleSwitch
          size="SM"
          label="Create More"
          labelClass="text-ink-muted font-normal"
          checked={createMore()}
          onChange={setCreateMore}
        />
        <Button
          onClick={handleCreateTask}
          class="border border-edge-muted pr-1"
          disabled={title().trim().length === 0}
        >
          <EntityIcon targetType="task" theme="monochrome" />
          Create Task
          <div class="text-[0.625rem] text-ink-extra-muted ml-auto border border-edge-muted/50 px-1.5 py-1 font-sans rounded-xs">
            <Hotkey shortcut="cmd+enter" />
          </div>
        </Button>
      </div>
    </div>
  );
}
