import '@fontsource-variable/inter';
import '@fontsource-variable/roboto-mono';
import '../../../index.css';
import { useAppSquishHandlers } from '@components/app/useAppSquishHandlers';
import { registerHotkey, useHotKeyRoot } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import {
  cellPlainText,
  encodeCellMention,
} from '@macro-inc/spreadsheet/cell-mentions';
import { createEffect, createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { CellMentionEditor } from '../components/CellMentionEditor';
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
      globalShortcutCount: () => number;
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
  const [globalShortcutCount, setGlobalShortcutCount] = createSignal(0);
  if (params.has('hotkeys')) {
    useHotKeyRoot();
    registerHotkey({
      scopeId: 'global',
      hotkey: ['h', 'arrowdown'],
      description: 'Fixture app navigation',
      keyDownHandler: () => {
        setGlobalShortcutCount((count) => count + 1);
        return true;
      },
    });
  }
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
    globalShortcutCount,
  };
  onCleanup(() => {
    // Revoke the fixture bridge when Vite unmounts this owner during HMR.
    Reflect.deleteProperty(window, 'spreadsheetFixture');
  });

  return (
    <main class="h-[calc(var(--dvh,1dvh)*100)] w-screen overflow-hidden bg-page font-sans text-ink">
      <SpreadsheetEditor
        mentions={
          params.has('mentions')
            ? {
                renderText: cellPlainText,
                renderEditor: (props) => (
                  <CellMentionEditor
                    {...props}
                    convertPaste={(value) => value}
                    renderMenu={(menu, _anchor, pick) => (
                      <button
                        type="button"
                        class="fixed right-4 top-4 z-[100]"
                        aria-label="Mention Taylor"
                        onPointerDown={(e) => e.preventDefault()}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() =>
                          pick(
                            encodeCellMention({
                              type: 'user',
                              userId: 'macro|taylor@macro.com',
                              email: 'taylor@macro.com',
                              displayName: 'Taylor',
                            })
                          )
                        }
                      >
                        Taylor ({menu.searchTerm()})
                      </button>
                    )}
                  />
                ),
              }
            : undefined
        }
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
