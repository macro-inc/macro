import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  type CodeBlockMode,
  CodeContent,
} from '@block-code/component/CodeContent';
import { CodeModeControl } from '@block-code/component/CodeModeControl';
import { isHtmlFileType } from '@block-code/util/fileMode';
import { downloadFile } from '@filesystem/download';
import { Rerun } from '@solid-primitives/keyed';
import {
  type Accessor,
  createSignal,
  type JSX,
  type Setter,
  Show,
} from 'solid-js';
import {
  FileDetailLayout,
  FileDetailLoadGate,
  type FileDetailShareProps,
} from '../components/FileDetail';
import { downloadFileOperation } from '../components/file-detail-operations';
import {
  type CodeDocumentData,
  loadCodeDocument,
  saveCodeDocument,
} from '../queries/code-document';
import { documentDownloadName } from '../util/document-download-name';
import type { FileDetailContext } from '../util/file-detail-context';

export type CodeDetailContext = FileDetailContext<CodeDocumentData>;

function CodeDetailContent(props: {
  documentId: string;
  data: CodeDocumentData;
  text: Accessor<string>;
  onTextChange: Setter<string>;
}) {
  const documentId = props.documentId;
  const fileType = props.data.documentMetadata.fileType;
  const readOnly =
    props.data.userAccessLevel !== 'owner' &&
    props.data.userAccessLevel !== 'edit';
  const isHtmlFile = isHtmlFileType(fileType);
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
          text={props.text()}
          fileType={fileType}
          readOnly={readOnly}
          mode={mode()}
          onTextChange={props.onTextChange}
          onSave={(nextText) => saveCodeDocument(documentId, nextText)}
        />
      </div>
    </div>
  );
}

function CodeDetailSession(props: {
  documentId: string;
  data: CodeDocumentData;
  children?: (context: CodeDetailContext) => JSX.Element;
}) {
  const analytics = useAnalytics();
  const [text, setText] = createSignal(props.data.text);
  const operations = [
    downloadFileOperation(() => {
      downloadFile(
        new Blob([text() ?? ''], { type: 'text/plain' }),
        documentDownloadName(props.data.documentMetadata)
      );
      analytics.track('download', { blockType: 'code' });
    }),
  ];

  return (
    <>
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
      })}
      <CodeDetailContent
        documentId={props.documentId}
        data={props.data}
        text={text}
        onTextChange={setText}
      />
    </>
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
      <Rerun
        on={() =>
          `${props.documentId}:${props.data.documentMetadata.documentVersionId}`
        }
      >
        {() => (
          <CodeDetailSession
            documentId={props.documentId}
            data={props.data}
            children={props.children}
          />
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
