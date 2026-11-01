import { useAnalytics } from '@app/lib/analytics/analytics-context';
import {
  type CodeBlockMode,
  CodeContent,
} from '@block-code/component/CodeContent';
import { CodeModeControl } from '@block-code/component/CodeModeControl';
import { isHtmlFileType } from '@block-code/util/fileMode';
import { SidePanel } from '@components/app/side-panel';
import { createFileDownload } from '@core/util/createFileDownload';
import { fireAndForget } from '@core/util/fireAndForget';
import { Rerun } from '@solid-primitives/keyed';
import { ok } from 'neverthrow';
import {
  type Accessor,
  createSignal,
  type JSX,
  type Setter,
  Show,
} from 'solid-js';
import { FileDetailLayout, FileDetailLoadGate } from '../components/FileDetail';
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
        <SidePanel.HeaderActions>
          <CodeModeControl mode={mode()} onModeChange={setMode} />
        </SidePanel.HeaderActions>
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
  const download = createFileDownload(() => ({
    id: `${props.documentId}:${props.data.documentMetadata.documentVersionId}`,
    name: documentDownloadName(props.data.documentMetadata),
    load: async () => {
      analytics.track('download', { blockType: 'code' });
      return ok({ blob: new Blob([text() ?? ''], { type: 'text/plain' }) });
    },
  }));
  const operations = [
    downloadFileOperation(() =>
      fireAndForget(download.start(), 'drive-file-download')
    ),
  ];

  return (
    <>
      {props.children?.({
        data: props.data,
        documentMetadata: props.data.documentMetadata,
        userAccessLevel: props.data.userAccessLevel,
        operations,
        download,
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

export function CodeDetailDocument(props: {
  documentId: string;
  data: CodeDocumentData;
  children?: (context: CodeDetailContext) => JSX.Element;
}) {
  return (
    <FileDetailLayout
      documentId={props.documentId}
      documentMetadata={props.data.documentMetadata}
      userAccessLevel={props.data.userAccessLevel}
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

export function CodeDetail(props: {
  documentId: string;
  children?: (context: CodeDetailContext) => JSX.Element;
}) {
  return (
    <FileDetailLoadGate
      documentId={props.documentId}
      entityType="code"
      label="code document"
      load={loadCodeDocument}
    >
      {(data) => (
        <CodeDetailDocument
          documentId={props.documentId}
          data={data}
          children={props.children}
        />
      )}
    </FileDetailLoadGate>
  );
}
