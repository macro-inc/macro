import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { Modals } from '@core/component/Properties/component/modal';
import {
  PropertyGrid,
  PropertyLabel,
  PropertyRow,
} from '@core/component/Properties/component/panel';
import { PropertyValue } from '@core/component/Properties/component/propertyValue';
import { SYSTEM_PROPERTY_IDS } from '@core/component/Properties/constants';
import {
  PropertiesProvider,
  usePropertiesContext,
} from '@core/component/Properties/context/PropertiesContext';
import type { Property } from '@core/component/Properties/types';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { createMarkdownFile } from '@core/util/create';
import { isErr } from '@core/util/maybeResult';
import { propertiesServiceClient } from '@service-properties/client';
import { useQuery } from '@tanstack/solid-query';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Suspense,
} from 'solid-js';

export interface ComposeTaskProps {
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
}

export function ComposeTask(props: ComposeTaskProps) {
  const [title, setTitle] = createSignal(props.initialTitle ?? '');
  const [content, setContent] = createSignal(props.initialContent ?? '');
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();

  const systemPropertiesQuery = useQuery(() => ({
    queryKey: ['compose-task', 'system-properties'],
    queryFn: async () => {
      const result = await propertiesServiceClient.listProperties({
        scope: 'system',
      });
      if (isErr(result)) {
        throw new Error('Failed to fetch system properties');
      }
      const [, data] = result;
      return data;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
  }));

  const properties = createMemo<Property[]>(() => {
    if (!systemPropertiesQuery.isSuccess) return [];
    const data = systemPropertiesQuery.data;
    return data
      .map((p) => {
        let definition = 'definition' in p ? p.definition : p;
        return {
          propertyId: 'TEMP_ID',
          propertyDefinitionId: definition.id,
          displayName: definition.display_name,
          isMultiSelect: definition.is_multi_select,
          isMetadata: definition.is_metadata,
          owner: definition.owner,
          createdAt: '',
          updatedAt: '',
          valueType: definition.data_type,
          value: null,
        };
      })
      .filter((prop) =>
        [
          SYSTEM_PROPERTY_IDS.ASSIGNEES,
          SYSTEM_PROPERTY_IDS.STATUS,
          SYSTEM_PROPERTY_IDS.PRIORITY,
        ].includes(prop.propertyDefinitionId as any)
      );
  });

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
        setTitle('');
        setContent('');
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
                  <PropertyRow
                    property={prop}
                    onValueClick={handleValueClick}
                  />
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
