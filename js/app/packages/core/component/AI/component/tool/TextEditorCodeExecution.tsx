import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg';
import File from '@phosphor-icons/core/regular/file.svg';
import type {
  TextEditorCodeExecutionContent,
  TextEditorCodeExecutionResult,
} from '@service-cognition/generated/tools/types';

// Type aliases for backwards compatibility with discriminated union variants
type TextEditorCodeExecutionViewResult = TextEditorCodeExecutionResult & {
  type: 'text_editor_code_execution_view_result';
};
type TextEditorCodeExecutionCreateResult = TextEditorCodeExecutionResult & {
  type: 'text_editor_code_execution_create_result';
};
type TextEditorCodeExecutionStrReplaceResult = TextEditorCodeExecutionResult & {
  type: 'text_editor_code_execution_str_replace_result';
};
import { createSignal, Match, Show, Switch } from 'solid-js';
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

const MAX_OUTPUT_LINES = 5;

function getCommandLabel(command: string): string {
  switch (command) {
    case 'view':
      return 'Viewing file';
    case 'create':
      return 'Creating file';
    case 'str_replace':
      return 'Editing file';
    default:
      return 'Editing file';
  }
}

function CodeFence(props: { content: string; maxLines: number }) {
  const [expanded, setExpanded] = createSignal(false);

  const lines = () => props.content.split('\n');
  const needsTruncation = () => lines().length > props.maxLines;
  const displayContent = () => {
    if (expanded() || !needsTruncation()) {
      return props.content;
    }
    return lines().slice(0, props.maxLines).join('\n');
  };

  return (
    <div class="relative">
      <Show when={needsTruncation()}>
        <button
          type="button"
          class="text-ink-extra-muted hover:text-ink-muted absolute top-1 right-1 p-1"
          onClick={() => setExpanded(!expanded())}
        >
          <Show when={expanded()} fallback={<CaretRight class="h-4 w-4" />}>
            <CaretDown class="h-4 w-4" />
          </Show>
        </button>
      </Show>
      <pre
        class="text-ink-muted bg-background-secondary overflow-x-auto rounded p-2 pr-8 font-mono text-xs whitespace-pre-wrap"
        classList={{
          'max-h-32 overflow-hidden': !expanded() && needsTruncation(),
        }}
      >
        {displayContent()}
      </pre>
    </div>
  );
}

function ViewResult(props: { result: TextEditorCodeExecutionViewResult }) {
  const hasContent = () => !!props.result.content?.trim();

  return (
    <Show
      when={hasContent()}
      fallback={<span class="text-ink-muted">Empty file</span>}
    >
      <CodeFence
        content={props.result.content ?? ''}
        maxLines={MAX_OUTPUT_LINES}
      />
    </Show>
  );
}

function CreateResult(props: { result: TextEditorCodeExecutionCreateResult }) {
  return (
    <span class="text-ink-muted">
      {props.result.is_file_update ? 'File updated' : 'File created'}
    </span>
  );
}

function StrReplaceResult(props: {
  result: TextEditorCodeExecutionStrReplaceResult;
}) {
  const diffContent = () => props.result.lines?.join('\n') ?? '';
  const hasContent = () => diffContent().trim().length > 0;

  return (
    <Show
      when={hasContent()}
      fallback={<span class="text-ink-muted">Edit applied</span>}
    >
      <CodeFence content={diffContent()} maxLines={MAX_OUTPUT_LINES} />
    </Show>
  );
}

function TextEditorResult(props: { content: TextEditorCodeExecutionContent }) {
  return (
    <Switch>
      <Match
        when={
          props.content.type === 'text_editor_code_execution_view_result' &&
          props.content
        }
      >
        {(result) => (
          <ViewResult result={result() as TextEditorCodeExecutionViewResult} />
        )}
      </Match>
      <Match
        when={
          props.content.type === 'text_editor_code_execution_create_result' &&
          props.content
        }
      >
        {(result) => (
          <CreateResult
            result={result() as TextEditorCodeExecutionCreateResult}
          />
        )}
      </Match>
      <Match
        when={
          props.content.type ===
            'text_editor_code_execution_str_replace_result' && props.content
        }
      >
        {(result) => (
          <StrReplaceResult
            result={result() as TextEditorCodeExecutionStrReplaceResult}
          />
        )}
      </Match>
      <Match
        when={
          props.content.type === 'text_editor_code_execution_tool_result_error'
        }
      >
        <span class="text-ink-error">Failed</span>
      </Match>
    </Switch>
  );
}

const handler = createToolRenderer({
  name: 'text_editor_code_execution',
  renderCall: (ctx) => (
    <BaseTool
      icon={File}
      text={getCommandLabel(ctx.tool.data.command)}
      renderContext={ctx.renderContext}
      type="call"
    >
      <code class="text-ink-muted font-mono text-xs">{ctx.tool.data.path}</code>
    </BaseTool>
  ),
  renderResponse: (ctx) => {
    return (
      <BaseTool
        icon={File}
        text="File operation"
        renderContext={ctx.renderContext}
        type="response"
      >
        <TextEditorResult content={ctx.tool.data.content} />
      </BaseTool>
    );
  },
});

export const textEditorCodeExecutionHandler = handler;
