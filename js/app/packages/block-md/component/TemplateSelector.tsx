import { TEMPLATES, type Template } from '@block-md/component/templates';
import { createBlockSignal } from '@core/block';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { setEditorStateFromMarkdown } from '@core/component/LexicalMarkdown/utils';
import { useEmail } from '@service-gql/client';
import { createCallback } from '@solid-primitives/rootless';
import { debounce } from '@solid-primitives/scheduled';
import type { LexicalEditor } from 'lexical';
import { createMemo, For, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { TitlePlaceholderSignal } from './TitleEditor';

const showTemplatePreviewSignal = createBlockSignal(false);
const selectedTemplateSignal = createBlockSignal<Template | undefined>(
  undefined
);

const populateContent = (content: string) => {
  const userEmail = useEmail();
  const today = new Date();
  const formattedDate = today.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const formattedTime = today.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  let populatedContent = content;
  populatedContent = populatedContent.replaceAll('[DATE]', `${formattedDate}`);
  populatedContent = populatedContent.replaceAll('[TIME]', `${formattedTime}`);
  populatedContent = populatedContent.replaceAll(
    '[USER]',
    `${userEmail() ?? 'User'}`
  );
  return populatedContent;
};

function TemplateCard(props: {
  titleEditor: LexicalEditor | undefined;
  editor: LexicalEditor;
  template: Template;
}) {
  const [_titlePlaceholder, setTitlePlaceholder] = TitlePlaceholderSignal;
  const setShowTemplatePreview = showTemplatePreviewSignal.set;
  const setSelectedTemplate = selectedTemplateSignal.set;
  const debouncedSetShowTemplatePreview = debounce(setShowTemplatePreview, 100);

  const createMarkdownFile = createCallback((template: Template) => {
    setEditorStateFromMarkdown(
      props.editor,
      populateContent(template.content),
      'internal',
      false
    );
    const titleEditor = props.titleEditor;
    if (titleEditor) {
      setEditorStateFromMarkdown(
        titleEditor,
        populateContent(template.title),
        'internal',
        false
      );
    }
  });

  return (
    <button
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        createMarkdownFile(props.template);
        setSelectedTemplate(undefined);
        setShowTemplatePreview(false);
        setTitlePlaceholder(undefined);
      }}
      onMouseEnter={() => {
        setSelectedTemplate(props.template);
        debouncedSetShowTemplatePreview(true);
        setTitlePlaceholder(populateContent(props.template.title));
      }}
      onMouseLeave={() => {
        setSelectedTemplate(undefined);
        setTitlePlaceholder(undefined);
        setShowTemplatePreview(false);
      }}
      class="flex flex-col justify-between p-4 rounded-lg border border-edge shadow hover:border-accent hover-transition-border transition"
    >
      <div>
        <div class="text-sm text-left font-medium text-ink">
          {props.template.name}
        </div>
        <div class="mt-1 text-left text-xs text-ink-placeholder">
          {props.template.subtext}
        </div>
      </div>
    </button>
  );
}

export function TemplateSelector(props: {
  titleEditor: LexicalEditor | undefined;
  editor: LexicalEditor;
  editorContainerRef: HTMLDivElement;
}) {
  const previewMarkdown = createMemo(() => {
    const currentTemplate = selectedTemplateSignal();
    if (currentTemplate) {
      return populateContent(currentTemplate.content);
    }
    return '';
  });

  return (
    <>
      <Show when={showTemplatePreviewSignal() && selectedTemplateSignal()}>
        <Portal mount={props.editorContainerRef}>
          <div class="absolute inset-0 w-full h-full text-ink-disabled bg-dialog overflow-hidden">
            <StaticMarkdown
              markdown={`${previewMarkdown()}`}
              theme={{
                quote:
                  'border-l-2 border-edge pl-4 py-2 italic text-ink-disabled my-4',
              }}
            />
          </div>
        </Portal>
      </Show>

      <div class="grid grid-cols-1 @sm:grid-cols-2 @md:grid-cols-2 @lg:grid-cols-3 gap-4 p-4">
        <For each={TEMPLATES}>
          {(template) => (
            <TemplateCard
              titleEditor={props.titleEditor}
              editor={props.editor}
              template={template}
            />
          )}
        </For>
      </div>
    </>
  );
}
