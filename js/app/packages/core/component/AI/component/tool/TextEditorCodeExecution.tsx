import type { CodeFileExtension } from '@block-code/util/languageSupport';
import { asFileType } from '@core/component/AI/util/attachment';
import { EntityIcon } from '@core/component/EntityIcon';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { createCodeFileFromText } from '@core/util/create';
import {
  allSupportedExtensionSet,
  isCodeEditorExtensionSupported,
} from '@core/util/languageQuery';
import { isOk } from '@core/util/maybeResult';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg';
import File from '@phosphor-icons/core/regular/file.svg';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  TextEditorCodeExecutionContent,
  TextEditorCodeExecutionResult,
} from '@service-cognition/generated/tools/types';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createSignal, Match, onMount, Show, Switch } from 'solid-js';

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
import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

type CreatedFileInfo = {
  documentId: string;
  fileName: string;
  extension: string;
};

const createdFilesMap: Record<string, CreatedFileInfo> = {};

function getExtensionFromPath(path: string): string | null {
  const fileName = path.split('/').pop() ?? '';
  const parts = fileName.split('.');
  if (parts.length < 2) return null;
  return parts.pop()?.toLowerCase() ?? null;
}

function getFileNameFromPath(path: string): string {
  return path.split('/').pop() ?? 'file';
}

const MAX_OUTPUT_LINES = 5;

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

function CreateResult(props: {
  result: TextEditorCodeExecutionCreateResult;
  toolId: string;
}) {
  const { replaceOrInsertSplit } = useSplitLayout();
  const [createdFile, setCreatedFile] = createSignal<CreatedFileInfo | null>(
    createdFilesMap[props.toolId] ?? null
  );

  // Fetch the mapping from backend if not in memory (e.g., after page refresh)
  onMount(async () => {
    if (createdFile()) return;

    const result = await cognitionApiServiceClient.getIdMapping({
      source_id: props.toolId,
    });

    if (isOk(result) && result[1]) {
      try {
        const fileInfo = JSON.parse(result[1]) as CreatedFileInfo;
        createdFilesMap[props.toolId] = fileInfo;
        setCreatedFile(fileInfo);
      } catch {
        // Invalid JSON, ignore
      }
    }
  });

  const handleClick = () => {
    const file = createdFile();
    if (file) {
      const blockName = fileTypeToBlockName(file.extension);
      replaceOrInsertSplit({ type: blockName, id: file.documentId });
    }
  };

  return (
    <div class="flex items-center gap-2">
      <span class="text-ink-muted">
        {props.result.is_file_update ? 'File updated' : 'File created'}
      </span>
      <Show when={createdFile()}>
        {(file) => (
          <button
            type="button"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover transition-colors cursor-pointer"
            onClick={handleClick}
          >
            <EntityIcon size="xs" targetType={asFileType(file().extension)} />
            <TruncatedText size="sm">
              <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
                {file().fileName}
              </span>
            </TruncatedText>
          </button>
        )}
      </Show>
    </div>
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

function TextEditorResult(props: {
  content: TextEditorCodeExecutionContent;
  toolId: string;
}) {
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
            toolId={props.toolId}
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
  handleResponse: async (ctx) => {
    const { content } = ctx.toolResponse.tool.data;
    const { command, file_text: fileText, path } = ctx.toolCall.tool.data;

    // Only create macro files for successful file creations
    if (
      content.type !== 'text_editor_code_execution_create_result' ||
      command !== 'create' ||
      !fileText
    ) {
      return;
    }

    const extension = getExtensionFromPath(path);
    if (!extension || !allSupportedExtensionSet.has(extension)) {
      return;
    }

    // Only create macro files for supported code file extensions
    if (!isCodeEditorExtensionSupported(extension)) {
      return;
    }

    const fileName = getFileNameFromPath(path);

    const result = await createCodeFileFromText({
      code: fileText,
      extension: extension as CodeFileExtension,
      title: fileName,
    });

    if (isOk(result)) {
      const documentId = result[1].documentId;
      createdFilesMap[ctx.toolResponse.tool.id] = {
        documentId,
        fileName,
        extension,
      };

      // Persist the mapping to the backend for retrieval on chat refresh
      await cognitionApiServiceClient.createIdMapping({
        source_id: ctx.toolResponse.tool.id,
        target_id: JSON.stringify({ documentId, fileName, extension }),
      });
    }
  },
  renderCall: (ctx) => (
    <BaseTool icon={File} renderContext={ctx.renderContext} type="call">
      <code class="text-ink-muted font-mono text-xs">{ctx.tool.data.path}</code>
    </BaseTool>
  ),
  renderResponse: (ctx) => {
    return (
      <BaseTool renderContext={ctx.renderContext} type="response">
        <TextEditorResult
          content={ctx.toolResponse.tool.data.content}
          toolId={ctx.toolResponse.tool.id}
        />
      </BaseTool>
    );
  },
});

export const textEditorCodeExecutionHandler = handler;
