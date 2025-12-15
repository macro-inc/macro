import { MarkdownTextarea } from '@core/component/LexicalMarkdown/component/core/MarkdownTextarea';
import { PropertiesProvider } from '@core/component/Properties/context/PropertiesContext';
import type { Property } from '@core/component/Properties/types';
import { TextButton } from '@core/component/TextButton';
import { toast } from '@core/component/Toast/Toast';
import { createMarkdownFile } from '@core/util/create';
import { createSignal } from 'solid-js';

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
        // Clear the form
        setTitle('');
        setContent('');
        props.onCreateTask?.(taskTitle, taskContent);
        props.onClose?.();
      } else {
        toast.failure('Failed to create task');
      }
    }
  };

  const properties: Property[] = [{}];

  return (
    <div class="flex flex-col gap-4 h-96 p-4">
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

      {/* Content Editor */}
      <div class="flex-1 min-h-0 text-base">
        <MarkdownTextarea
          editable={() => true}
          onChange={(value) => setContent(value)}
          initialValue={props.initialContent}
          placeholder={props.placeholder ?? 'Add description...'}
          class="h-full"
        />
      </div>
      <PropertiesProvider
        entityType="TASK"
        canEdit={true}
        properties={properties}
        onRefresh={() => {}}
        onPropertyAdded={() => {}}
        onPropertyDeleted={() => {}}
      >
        <div class="w-full bg-yellow-200"></div>
      </PropertiesProvider>

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
