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

import Terminal from '@phosphor-icons/core/regular/terminal.svg';
import { cognitionApiServiceClient } from '@service-cognition/client';
import type {
  TextEditorCodeExecutionContent,
  TextEditorCodeExecutionResult,
} from '@service-cognition/generated/tools/types';
import { useSplitLayout } from 'app/component/split-layout/layout';
import { createSignal, Match, onMount, Show, Switch } from 'solid-js';

// Type alias for backwards compatibility with discriminated union variant
type TextEditorCodeExecutionCreateResult = TextEditorCodeExecutionResult & {
  type: 'text_editor_code_execution_create_result';
};

import { BaseTool } from './BaseTool';
import { createToolRenderer } from './ToolRenderer';

type FileCreationData = {
  path: string;
  fileText: string;
};

type CreatedFileInfo = {
  documentId: string;
  fileName: string;
  extension: string;
};

const toolFileDataMap: Record<string, FileCreationData> = {};
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

    if (result.isOk() && result.value) {
      try {
        const fileInfo = JSON.parse(result.value) as CreatedFileInfo;
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
    <div class="flex items-center">
      <Show when={createdFile()}>
        {(file) => (
          <button
            type="button"
            class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-hover transition-colors"
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

function InlineTextEditorResult(props: {
  content: TextEditorCodeExecutionContent;
  toolId: string;
}) {
  return (
    <Switch>
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
          props.content.type === 'text_editor_code_execution_tool_result_error'
        }
      >
        <span class="text-ink-error">Failed</span>
      </Match>
      <Match
        when={props.content.type === 'text_editor_code_execution_view_result'}
      >
        <span class="text-ink-extra-muted">Viewed file</span>
      </Match>
      <Match
        when={
          props.content.type === 'text_editor_code_execution_str_replace_result'
        }
      >
        <span class="text-ink-extra-muted">Edit applied</span>
      </Match>
    </Switch>
  );
}

const handler = createToolRenderer({
  name: 'TextEditorCodeExecution',
  handleCall: async (_ctx) => {
    // The new tool shape has a single `input` string field;
    // file-creation side effects are no longer possible from the call data alone.
  },
  handleResponse: async (ctx) => {
    const { content } = ctx.tool.data;
    const fileData = toolFileDataMap[ctx.tool.id];

    if (content.type !== 'text_editor_code_execution_create_result') {
      return;
    }

    if (!fileData) {
      return;
    }

    delete toolFileDataMap[ctx.tool.id];

    const extension = getExtensionFromPath(fileData.path);
    if (!extension || !allSupportedExtensionSet.has(extension)) {
      return;
    }

    // Only create macro files for supported code file extensions
    if (!isCodeEditorExtensionSupported(extension)) {
      return;
    }

    const fileName = getFileNameFromPath(fileData.path);

    const result = await createCodeFileFromText({
      code: fileData.fileText,
      extension: extension as CodeFileExtension,
      title: fileName,
    });

    if (result.isOk()) {
      const documentId = result.value.documentId;
      createdFilesMap[ctx.tool.id] = {
        documentId,
        fileName,
        extension,
      };

      // Persist the mapping to the backend for retrieval on chat refresh
      await cognitionApiServiceClient.createIdMapping({
        source_id: ctx.tool.id,
        target_id: JSON.stringify({ documentId, fileName, extension }),
      });
    }
  },
  render: (ctx) => (
    <BaseTool icon={Terminal} renderContext={ctx.renderContext} type="call">
      <div class="flex min-w-0 flex-1 items-center justify-between gap-3 overflow-hidden">
        <span class="min-w-0 truncate">Uploaded code</span>
        <Show when={ctx.response}>
          {(response) => (
            <div class="shrink-0">
              <InlineTextEditorResult
                content={response().data.content}
                toolId={ctx.tool.id}
              />
            </div>
          )}
        </Show>
      </div>
    </BaseTool>
  ),
});

export const textEditorCodeExecutionHandler = handler;
