import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '../../../index.css';
import { useAppSquishHandlers } from '@components/app/useAppSquishHandlers';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import type { SpreadsheetWorkbookSheet } from '../core/workbook-document';
import { createLocalSpreadsheetSource } from '../primitives/create-local-spreadsheet-source';
import { createSpreadsheetStore } from '../primitives/create-spreadsheet-store';
import { createSpreadsheetSession } from '../queries/spreadsheet-session';
import { SpreadsheetEditor } from '../views/SpreadsheetEditor';

declare global {
  interface Window {
    spreadsheetFixture: {
      snapshot: () => SpreadsheetWorkbookSheet[];
      setReadonly: (readonly: boolean) => void;
      connectionStatus: () => string;
    };
  }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function Fixture() {
  useAppSquishHandlers();
  // The production app sets this attribute for the shared `touch:` styles.
  createEffect(() => {
    document.documentElement.dataset.touchDevice = String(isTouchDevice());
  });
  const [readonly, setReadonly] = createSignal(
    new URLSearchParams(location.search).has('readonly')
  );
  const params = new URLSearchParams(location.search);
  const documentId = params.get('document');
  const socketUrl = params.get('socket');
  const socket =
    documentId && socketUrl ? createSyncSocket(socketUrl) : undefined;
  const connection = socket ? createWebsocketStateSignal(socket) : undefined;
  const live = socket
    ? new SyncServiceSource(socket, documentId!, {
        status: () => mapToSyncStatus(connection!()),
      })
    : undefined;
  const source = live
    ? createSpreadsheetSession({
        documentId: documentId!,
        userId: params.get('user') ?? undefined,
        canEdit: () => !readonly(),
        syncSource: live,
        doInitialSync: live.doInitialSync,
      })
    : createLocalSpreadsheetSource({
        A1: { value: 'Item', bold: true },
        B1: { value: 'Amount', bold: true },
        A2: { value: 'Design' },
        B2: { value: '10' },
        A3: { value: 'Engineering' },
        B3: { value: '20' },
        A4: { value: 'Total', bold: true },
        B4: { value: '=SUM(B2:B3)', bold: true },
      });
  const store = createSpreadsheetStore({ source, canEdit: () => !readonly() });
  window.spreadsheetFixture = {
    snapshot: () => structuredClone(store.workbook()),
    setReadonly,
    connectionStatus: source.status,
  };
  onCleanup(() => {
    // Revoke the fixture bridge when Vite unmounts this owner during HMR.
    Reflect.deleteProperty(window, 'spreadsheetFixture');
  });

  return (
    <main class="h-[calc(var(--dvh,1dvh)*100)] w-screen overflow-hidden bg-page font-sans text-ink">
      <SpreadsheetEditor
        store={store}
        name="Browser fixture"
        autoFocus
        onExport={(content) =>
          download(
            new Blob([content], { type: 'text/csv;charset=utf-8' }),
            'Spreadsheet fixture.csv'
          )
        }
        onExportXlsx={(bytes) =>
          download(
            new Blob([bytes.slice().buffer], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
            'Spreadsheet fixture.xlsx'
          )
        }
      />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Spreadsheet fixture root is missing.');
const dispose = render(() => <Fixture />, root);
import.meta.hot?.dispose(dispose);
