import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { ToastRegion } from '@core/component/Toast/ToastRegion';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  ABI_MAJOR,
  EditorInputMsg,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  mountLocalSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { createRoot } from 'solid-js';
import { render } from 'solid-js/web';
import * as native from '../../../../document-session/wasm/document_session_wasm';
import { FloatingMenuGroup } from '../../context/FloatingMenuContext';
import { theme } from '../../theme';
import { installNativeMarkdownOverlays } from '../installNativeMarkdownOverlays';
import { createNativeDatabaseController } from '../overlay-hosts/native-database';
import { installDatabaseFixtureViews } from './fixture-views';
import { complete } from './service';

function element(id: string) {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing ${id}`);
  return node;
}
await native.default();
const { runtime, close } = createRoot((disposeOwner) => {
  const runtime = mountLocalSessionView(
    element('body'),
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: 'database-action-fixture',
      theme,
      editable: true,
      preset: 'rich',
      onError(error) {
        throw error;
      },
    },
    {
      viewEngine: 1,
      viewOs: 0,
      nativeCommands: native,
      create: (config, now, wall) =>
        native.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          config,
          now,
          wall,
          'database-action-fixture'
        ),
    }
  );
  const releaseViews = installDatabaseFixtureViews(runtime.view);
  const database = createNativeDatabaseController(runtime.view);
  const installed = installNativeMarkdownOverlays(runtime.view, {
    canEdit: () => true,
    actions: {
      requests: {
        async requestDatabase(context) {
          await database.requestDatabase(context);
          saveState();
        },
      },
      actionContext: { disableMentionTracking: true },
    },
  });
  const dispose = render(
    () => (
      <AnalyticsContextProvider>
        <PosthogProvider>
          <ToastRegion />
          <FloatingMenuGroup>
            {installed.Overlays && <installed.Overlays />}
          </FloatingMenuGroup>
        </PosthogProvider>
      </AnalyticsContextProvider>
    ),
    element('menus')
  );
  return {
    runtime,
    async close() {
      try {
        database.dispose();
        releaseViews();
        installed.dispose();
        dispose();
      } finally {
        try {
          await runtime.close();
        } finally {
          disposeOwner();
        }
      }
    },
  };
});
const seeded = await runtime.port.inputSettled(
  EditorInputMsg.fromEditorSetState({
    json: JSON.stringify({
      root: {
        type: 'root',
        version: 1,
        children: [{ type: 'paragraph', version: 1, children: [] }],
      },
    }),
  })
);
if (seeded.status !== 'success') throw new Error('Native fixture seed failed');
element('complete').addEventListener('click', complete);
function saveState() {
  element('model').textContent = runtime.port.query({
    kind: 7,
    key: 0,
    flags: 0,
    text: '',
  }).text;
}
element('save').addEventListener('click', saveState);
window.addEventListener(
  'pagehide',
  () => fireAndForget(close(), 'database.fixture.close'),
  { once: true }
);
document.documentElement.dataset.ready = 'true';
