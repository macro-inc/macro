import { useSplitLayout } from '@app/component/split-layout/layout';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { initializeEditorEmpty } from '@core/component/LexicalMarkdown/utils';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { createTask } from '@core/util/create';
import { filterMap } from '@core/util/list';
import { buildSimpleEntityUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import SplitIcon from '@phosphor/square-half.svg';
import XIcon from '@phosphor/x.svg';
import {
  propertyApiValuesToNormalized,
  propertyValueToApi,
} from '@property/api/converters';
import { Modals } from '@property/component/modal';
import { PROPERTY_OPTION_IDS, SYSTEM_PROPERTY_IDS } from '@property/constants';
import {
  PropertiesProvider,
  type PropertySaveHandler,
} from '@property/context/PropertiesContext';
import type {
  Property,
  PropertyApiValues,
  PropertyOption,
} from '@property/types';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { refetchSoupEntity } from '@queries/soup/cache';
import { propertiesServiceClient } from '@service-properties/client';
import type { PropertyDefinition } from '@service-properties/generated/schemas/propertyDefinition';
import { debounce } from '@solid-primitives/scheduled';
import { useQuery } from '@tanstack/solid-query';
import { Button, Hotkey, Scroll, ToggleSwitch } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { createStore, reconcile, type Store, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  updateDraftTimestamp,
} from '../util/taskComposerStorage';
import { InlinePropertyValue } from './InlinePropertyValue';

// Show these props in the composer (Linear-style left-to-right order).
const COMPOSER_PROPERTIES = [
  SYSTEM_PROPERTY_IDS.STATUS,
  SYSTEM_PROPERTY_IDS.PRIORITY,
  SYSTEM_PROPERTY_IDS.ASSIGNEES,
  SYSTEM_PROPERTY_IDS.DUE_DATE,
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

  // refetchSoupEntity is already called inside createTask — just upsert to history
  refetchSoupEntity(documentId, 'document');

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

export type ComposeTaskSuccess = {
  documentId: string;
  title: string;
  content: string;
};

export interface ComposeTaskProps {
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
  initialAssigneeIds?: string[];
  /**
   * When provided, replaces the default success behavior (auto-copy link +
   * toast) so the caller can handle the created task however it needs.
   */
  onSuccess?: (result: ComposeTaskSuccess) => void;
  /**
   * Fires when the user submits and the dialog closes but the create-task
   * network call is still in flight. The originating editor can use this to
   * drop in an await placeholder which onSuccess later replaces.
   */
  onCreateStart?: (init: { title: string; content: string }) => void;
  /**
   * Fires if the create-task API call fails after the dialog has been closed.
   * Pairs with onCreateStart for placeholder cleanup.
   */
  onCreateFailure?: () => void;
}

export function ComposeTask(props: ComposeTaskProps) {
  const splitPanel = useSplitPanelOrThrow();
  const { popoverSplit, openWithSplit } = useSplitLayout();
  const currentUserId = useUserId();

  const getDefaultPropertyValues = (): Record<string, PropertyApiValues> => {
    const ids = (() => {
      if (props.initialAssigneeIds && props.initialAssigneeIds.length > 0) {
        return [...new Set(props.initialAssigneeIds)];
      }
      const id = currentUserId();
      return id ? [id] : [];
    })();
    return {
      [SYSTEM_PROPERTY_IDS.ASSIGNEES]: {
        valueType: 'ENTITY' as const,
        refs: ids.map((entity_id) => ({
          entity_id,
          entity_type: 'USER' as const,
        })),
      },
      [SYSTEM_PROPERTY_IDS.STATUS]: {
        valueType: 'SELECT_STRING' as const,
        values: [PROPERTY_OPTION_IDS.STATUS.NOT_STARTED],
      },
    };
  };

  // draft init logic
  const initializeFromDraft = () => {
    if (
      !props.initialTitle &&
      !props.initialContent &&
      !props.initialAssigneeIds?.length
    ) {
      const draft = loadTaskComposerDraft();
      if (draft) {
        return {
          title: draft.title,
          content: draft.content,
          editorState: draft.editorState,
          propertyValues: draft.propertyValues,
          isDraftLoaded: true,
        };
      }
    }
    return {
      title: props.initialTitle ?? '',
      content: props.initialContent ?? '',
      editorState: undefined,
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
  const [isCreating, setIsCreating] = createSignal(false);
  let attachInputRef: HTMLInputElement | undefined;

  const handleAttachFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    const editor = bodyEditor();
    if (!editor || files.length === 0) return;
    for (const file of files) {
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      await addMediaFromFile(editor, file, mediaType);
    }
  };

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
    // Deeply read propertyValues so this effect subscribes to any property
    // change (e.g. setting a due date). unwrap()'d access doesn't subscribe,
    // so without this the draft only saved when title/content changed.
    JSON.stringify(propertyValues);
    const currentProperties = structuredClone(unwrap(propertyValues));

    if (hasInitializedFromDraft) {
      hasInitializedFromDraft = false;
      return;
    }

    debouncedSave({
      title: currentTitle,
      content: currentContent,
      editorState: bodyEditor()?.getEditorState().toJSON(),
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
      if (result.isErr()) {
        throw new Error('Failed to fetch system properties');
      }
      const data = result.value;
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

  const properties = (): Property[] => {
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
        updatedAt: new Date(0),
        createdAt: new Date(0),
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
        value: date,
      });
    },
  };

  const showTaskCreatedToast = async (documentId: string) => {
    // Auto-copy link to clipboard
    const url = buildSimpleEntityUrl({ type: 'task', id: documentId });
    let linkCopied = false;
    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
    } catch {
      toast.failure('Failed to copy link to clipboard');
    }

    toast.success('Task created', {
      subtext: linkCopied ? 'Link copied' : undefined,
      actions: [
        {
          label: 'Open',
          icon: ArrowSquareOutIcon,
          onClick: () => {
            openWithSplit(
              { type: 'task', id: documentId },
              { referredFrom: null }
            );
          },
        },
        {
          label: 'Open (New Split)',
          icon: SplitIcon,
          onClick: () => {
            openWithSplit(
              { type: 'task', id: documentId },
              { referredFrom: null, preferNewSplit: true }
            );
          },
        },
      ],
    });
  };

  const handleCreateTask = async () => {
    if (isCreating()) return;

    const taskTitle = title().trim();
    const taskContent = content().trim();

    if (!taskTitle) {
      setErrorMessage('Please give this task a title');
      return;
    }
    setErrorMessage('');

    setIsCreating(true);

    const properties = structuredClone(Object.entries(unwrap(propertyValues)));

    if (!createMore()) {
      // Snapshot the draft locally, then clear localStorage so a new dialog
      // opened while this creation is in flight starts blank.
      const draftSnapshot = {
        title: taskTitle,
        content: taskContent,
        propertyValues: structuredClone(unwrap(propertyValues)),
      };
      clearTaskComposerDraft();
      // Close the dialog immediately
      splitPanel.handle.close();
      props.onClose?.();
      console.log(
        '[ComposeTask] dispatching onCreateStart, hasHandler=',
        Boolean(props.onCreateStart)
      );
      props.onCreateStart?.({ title: taskTitle, content: taskContent });

      const documentId = await createTaskWithProperties(
        taskTitle,
        taskContent,
        properties,
        definitions(),
        (params) => upsertToHistoryMutation.mutate(params)
      );

      setIsCreating(false);

      if (!documentId) {
        props.onCreateFailure?.();
        // Restore the draft and re-open so the user can retry
        saveTaskComposerDraft(draftSnapshot);
        popoverSplit({ type: 'component', id: 'task-compose' });
        return;
      }

      if (props.onSuccess) {
        props.onSuccess({ documentId, title: taskTitle, content: taskContent });
      } else {
        showTaskCreatedToast(documentId);
      }
      props.onCreateTask?.(taskTitle, taskContent);
      return;
    }

    const documentId = await createTaskWithProperties(
      taskTitle,
      taskContent,
      properties,
      definitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );

    setIsCreating(false);

    if (!documentId) {
      return;
    }

    // Success: clear draft and notify
    clearTaskComposerDraft();
    if (props.onSuccess) {
      props.onSuccess({ documentId, title: taskTitle, content: taskContent });
    } else {
      showTaskCreatedToast(documentId);
    }
    props.onCreateTask?.(taskTitle, taskContent);

    if (createMore()) {
      // Reset form for next task
      setTitle('');
      setContent('');
      setPropertyValues(reconcile(getDefaultPropertyValues()));
      setIsDraftLoaded(false);
      const ed = bodyEditor();
      ed && initializeEditorEmpty(ed);
    }
  };

  const handleContinueInSplit = async () => {
    if (isCreating()) return;

    const taskTitle = title().trim();
    const taskContent = content().trim();

    setErrorMessage('');
    setIsCreating(true);

    const properties = structuredClone(Object.entries(unwrap(propertyValues)));
    const draftSnapshot = {
      title: taskTitle,
      content: taskContent,
      propertyValues: structuredClone(unwrap(propertyValues)),
    };
    clearTaskComposerDraft();

    splitPanel.handle.close();
    props.onClose?.();

    const split = openWithSplit(
      { type: 'component', id: 'loading' },
      { referredFrom: 'launcher', preferNewSplit: true }
    );

    const documentId = await createTaskWithProperties(
      taskTitle,
      taskContent,
      properties,
      definitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );

    setIsCreating(false);

    if (!documentId) {
      split?.goBack();
      saveTaskComposerDraft(draftSnapshot);
      popoverSplit({ type: 'component', id: 'task-compose' });
      return;
    }

    if (split) {
      split.replace({
        next: { type: 'task', id: documentId },
        mergeHistory: true,
        referredFrom: 'launcher',
      });
    } else {
      openWithSplit(
        { type: 'task', id: documentId },
        { referredFrom: 'launcher', preferNewSplit: true }
      );
    }

    props.onCreateTask?.(taskTitle, taskContent);
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

    let elem: Element | undefined;
    if (ndx >= 0) {
      // Editor is in tabbable list, navigate relative to it
      const next = (ndx + dir + tabbables.length) % tabbables.length;
      elem = tabbables.at(next);
    } else {
      // Editor not in tabbable list (contenteditable edge case)
      // Go to first element when moving forward, last when moving backward
      elem = dir === 1 ? tabbables.at(0) : tabbables.at(-1);
    }

    if (elem) {
      (elem as HTMLElement).focus();
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

  const editorConfig = buildConfig('markdown')
    .withMentions()
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
    .withHistory()
    .onChange(setContent)
    .onFocusLeave({
      onStart: (e) => editorFocusChange(e, -1),
      onEnd: (e) => editorFocusChange(e, +1),
    })
    .onEscape(() => {
      containerRef()?.focus();
      return true;
    });

  const editor = editorConfig.buildHandle().lexical;
  setBodyEditor(editor);

  return (
    <div
      class="flex flex-col relative h-full max-h-full min-h-0 p-4 gap-4"
      tabIndex={-1}
      ref={setContainerRef}
    >
      <div class="flex items-center gap-1">
        <div class="flex-1 flex items-center">
          <Show when={splitPanel?.handle.isPopover()}>
            <Button
              onMouseDown={handleContinueInSplit}
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-sm"
            >
              <ArrowsOutIcon />
            </Button>
          </Show>
        </div>
        <Show when={content().trim() || title()}>
          <Button
            onMouseDown={handleClearDraft}
            tabIndex={-1}
            tooltip="Clear Draft"
            size="sm"
            variant="base"
            depth={3}
            class="bg-surface px-3"
          >
            Clear Draft
          </Button>
        </Show>
        <Show when={splitPanel?.handle.isPopover()}>
          <Button
            onMouseDown={handleClose}
            tabIndex={-1}
            tooltip="Close"
            size="icon-sm"
          >
            <XIcon />
          </Button>
        </Show>
      </div>
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="shrink-0 flex gap-2 items-center px-2">
          <input
            type="text"
            placeholder="New task"
            value={title()}
            onInput={(e) => {
              setTitle(e.currentTarget.value);
              if (errorMessage()) {
                setErrorMessage('');
              }
            }}
            disabled={isCreating()}
            class="w-full py-2 text-xl font-medium placeholder-ink-placeholder disabled:opacity-50 truncate focus:overflow-visible"
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

        <div class="overflow-auto scrollbar-hidden mb-6 min-h-24 grow px-2">
          <Scroll>
            <MarkdownShell
              config={editorConfig}
              initialState={initialState.editorState}
              initialValue={
                initialState.editorState
                  ? undefined
                  : initialState.content || undefined
              }
              placeholder={props.placeholder ?? 'Add description...'}
              portalScope={splitPanel.handle.isPopover() ? 'local' : 'block'}
            />
          </Scroll>
        </div>

        <Suspense fallback={<div class="h-7" />}>
          <PropertiesProvider
            entityType="TASK"
            canEdit={true}
            properties={properties}
            onRefresh={() => {}}
            onPropertyAdded={() => {}}
            onPropertyDeleted={() => {}}
            saveHandler={saveHandler}
          >
            <div
              class="flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm m-px"
              on:keydown={(e) => {
                const target = e.target as HTMLElement;
                const container = e.currentTarget;
                const tabbables = tabbable(container);
                const isFirst = tabbables.indexOf(target) === 0;
                const isLast =
                  tabbables.indexOf(target) === tabbables.length - 1;

                // Shift+Tab or ArrowUp on first property -> focus editor
                if (
                  isFirst &&
                  ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp')
                ) {
                  const editor = bodyEditor();
                  if (editor) {
                    e.preventDefault();
                    e.stopPropagation();
                    editor.focus(undefined, { defaultSelection: 'rootEnd' });
                  }
                }

                // Tab or ArrowDown on last property -> let tabbable handle or wrap
                if (
                  isLast &&
                  ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown')
                ) {
                  // Allow default Tab behavior to continue to next focusable
                  // element outside this container
                }
              }}
            >
              <For each={properties()}>
                {(property) => (
                  <InlinePropertyValue
                    property={property}
                    emptyLabel={property.displayName}
                  />
                )}
              </For>
            </div>
            <Modals />
          </PropertiesProvider>
        </Suspense>
      </div>

      <Show when={errorMessage()}>
        <div class="w-full border-b border-edge-muted" />
        <div class="p-2">
          <div class="text-sm text-failure-ink px-3 py-2">{errorMessage()}</div>
        </div>
      </Show>

      <div class="shrink-0 flex justify-between items-end gap-2">
        <input
          ref={(el) => {
            attachInputRef = el;
          }}
          type="file"
          class="hidden"
          multiple
          accept="image/*,video/*"
          onChange={handleAttachFiles}
        />
        <Button
          onMouseDown={() => attachInputRef?.click()}
          tabIndex={-1}
          tooltip="Attach image or video"
          size="icon-sm"
        >
          <PaperclipIcon />
        </Button>
        <div class="flex items-center gap-3">
          <ToggleSwitch
            labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
            onChange={setCreateMore}
            checked={createMore()}
            label="Create More"
          />
          <Button
            onClick={handleCreateTask}
            disabled={title().trim().length === 0 || isCreating()}
            variant={title().trim().length === 0 ? 'ghost' : 'active'}
            depth={3}
            class="gap-3 rounded-lg border-0"
          >
            Create Task
            <Hotkey shortcut="cmd+enter" theme="current" />
          </Button>
        </div>
      </div>
    </div>
  );
}
