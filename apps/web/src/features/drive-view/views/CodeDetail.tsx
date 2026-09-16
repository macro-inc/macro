import {
  type CodeBlockMode,
  CodeContent,
} from '@block-code/component/CodeContent';
import { CodeModeControl } from '@block-code/component/CodeModeControl';
import { isHtmlFileType } from '@block-code/util/fileMode';
import { Rerun } from '@solid-primitives/keyed';
import { createSignal, type JSX, Show } from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import {
  type CodeDocumentData,
  loadCodeDocument,
  saveCodeDocument,
} from '../queries/code-document';

export type CodeDetailContext = {
  data: CodeDocumentData;
};

function CodeDetailContent(props: {
  documentId: string;
  data: CodeDocumentData;
}) {
  const documentId = props.documentId;
  const initialText = props.data.text;
  const fileType = props.data.documentMetadata.fileType;
  const readOnly =
    props.data.userAccessLevel !== 'owner' &&
    props.data.userAccessLevel !== 'edit';
  const isHtmlFile = isHtmlFileType(fileType);
  const [text, setText] = createSignal(initialText);
  const [mode, setMode] = createSignal<CodeBlockMode>(
    isHtmlFile ? 'render' : 'code'
  );

  return (
    <div class="flex size-full min-h-0 min-w-0 flex-col overflow-hidden">
      <Show when={isHtmlFile}>
        <div class="flex h-10 shrink-0 items-center justify-end border-edge border-b px-3">
          <CodeModeControl mode={mode()} onModeChange={setMode} />
        </div>
      </Show>
      <div class="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <CodeContent
          text={text()}
          fileType={fileType}
          readOnly={readOnly}
          mode={mode()}
          onTextChange={setText}
          onSave={(nextText) => saveCodeDocument(documentId, nextText)}
        />
      </div>
    </div>
  );
}

export function CodeDetailDocument(
  props: FileDetailShareProps & {
    documentId: string;
    data: CodeDocumentData;
    children?: (context: CodeDetailContext) => JSX.Element;
  }
) {
  const blockType = () =>
    props.data.documentMetadata.fileType?.toLowerCase() === 'csv'
      ? 'csv'
      : 'code';

  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
      blockType={blockType()}
      shareOpen={props.shareOpen}
      onShareOpenChange={props.onShareOpenChange}
    >
      {props.children?.({ data: props.data })}
      <Rerun
        on={() =>
          `${props.documentId}:${props.data.documentMetadata.documentVersionId}`
        }
      >
        {() => (
          <CodeDetailContent documentId={props.documentId} data={props.data} />
        )}
      </Rerun>
    </FileDetailLayout>
  );
}

export function CodeDetail(
  props: FileDetailShareProps & {
    documentId: string;
    children?: (context: CodeDetailContext) => JSX.Element;
  }
) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      label="code document"
      load={loadCodeDocument}
    >
      {(data) => (
        <CodeDetailDocument
          documentId={props.documentId}
          data={data}
          shareOpen={props.shareOpen}
          onShareOpenChange={props.onShareOpenChange}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
