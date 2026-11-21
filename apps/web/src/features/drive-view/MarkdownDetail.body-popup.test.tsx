/** @vitest-environment jsdom */
import { cleanup, render } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

// MarkdownDetail is the embedded markdown view's FE-70 entry: every Drive,
// task and CRM detail mounts the document through it, and it alone picks the
// body popup composition by device.

const control = vi.hoisted(() => ({
  touch: false,
  connectionType: 'sync' as 'sync' | 'session',
  sourceStatus: 0,
  sessionStatus: 1,
  initialSync: vi.fn(),
  documentProps: [] as Record<string, unknown>[],
  contentProps: [] as Record<string, unknown>[],
  headerStatus: [] as (() => unknown)[],
}));
const passthrough = (props: ParentProps) => props.children;
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => control.touch,
}));
vi.mock('@block-md/views/body-format-popup', () => ({
  desktopBodyFormatPopup: { device: 'desktop' },
}));
vi.mock('@block-md/views/mobile/body-format-popup', () => ({
  mobileBodyFormatPopup: { device: 'touch' },
}));
vi.mock('@block-md/component/MarkdownDocument', () => ({
  MarkdownDocument: (props: ParentProps<Record<string, unknown>>) => {
    control.documentProps.push(props);
    return props.children;
  },
  MarkdownDocumentContent: (props: Record<string, unknown>) => {
    control.contentProps.push(props);
    return null;
  },
}));
vi.mock('@block-md/component/HostedMarkdownHeader', () => ({
  HostedMarkdownHeader: (props: { collaborationStatus: () => unknown }) => {
    control.headerStatus.push(props.collaborationStatus);
    return null;
  },
}));
vi.mock('./components/FileDetail', () => ({
  FileDetailLoadGate: (props: { children: (data: unknown) => JSX.Element }) =>
    props.children({
      metadata: { documentId: 'document-1', documentName: 'Doc' },
      connection:
        control.connectionType === 'sync'
          ? {
              type: 'sync',
              source: { status: () => control.sourceStatus },
              doInitialSync: control.initialSync,
            }
          : { type: 'session', context: {} },
      permissions: { canComment: true, canEdit: true, isOwner: true },
      userAccessLevel: 'owner',
    }),
}));
vi.mock('@app/features/entity-appearance/queries/document-appearance', () => ({
  markdownEntityFromMetadata: () => undefined,
}));
vi.mock('@block-md/component/FindAndReplace', () => ({
  FindAndReplace: () => null,
}));
vi.mock('@block-md/component/ModalsProvider', () => ({
  ModalsProvider: passthrough,
}));
vi.mock('@block-md/component/sidepanel/MarkdownSidePanelSections', () => ({
  MarkdownSidePanelSections: () => null,
}));
vi.mock('@block-md/context/markdown-document-state', () => ({
  createMarkdownDocumentState: () => ({
    params: { navigate: () => {} },
    session: { status: () => control.sessionStatus },
  }),
}));
vi.mock('@block-md/primitives/create-markdown-route-navigation', () => ({
  createMarkdownRouteNavigation: () => {},
}));
vi.mock('@block-md/queries/markdown-document', () => ({
  loadMarkdownDocument: async () => undefined,
}));
vi.mock('@block-md/queries/markdown-document-operations', () => ({
  loadMarkdownCachedSnapshot: async () => undefined,
}));
vi.mock('@block-md/views/markdown-header-parts', () => ({
  MarkdownHeaderActions: () => null,
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalBlockOrchestrator: () => ({
    registerBlockHandle: () => ({}),
  }),
  useGlobalNotificationSource: () => undefined,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Layout: passthrough },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ splitHotkeyScope: 'scope' }),
}));
vi.mock('@core/orchestrator', () => ({ createMethodRegistration: () => {} }));
vi.mock('@notifications', () => ({
  DocumentNotificationReadMarker: () => null,
}));
vi.mock('@queries/preview', () => ({ useItemRawName: () => () => 'Doc' }));

const { MarkdownDetail } = await import('./views/MarkdownDetail');

afterEach(() => {
  cleanup();
  control.documentProps.length = 0;
  control.contentProps.length = 0;
  control.headerStatus.length = 0;
  control.connectionType = 'sync';
  control.sourceStatus = 0;
  control.sessionStatus = 1;
  control.initialSync.mockClear();
});

test.each([
  [false, 'desktop'],
  [true, 'touch'],
] as const)(
  'the embedded markdown entry on touch=%s hands MarkdownDocument the %s popup',
  (touch, device) => {
    control.touch = touch;
    render(() => <MarkdownDetail documentId="document-1" />);
    expect(control.documentProps).toHaveLength(1);
    expect(control.documentProps[0].bodyFormatPopup).toEqual({ device });
  }
);

test.each(['sync', 'session'] as const)(
  'the embedded %s document keeps status and initial sync with its model owner',
  (connectionType) => {
    control.connectionType = connectionType;
    render(() => <MarkdownDetail documentId="document-1" />);
    expect(control.documentProps[0].documentSource).toMatchObject({
      type: connectionType,
    });
    expect(control.headerStatus).toHaveLength(1);
    expect(control.headerStatus[0]()).toBe(connectionType === 'sync' ? 0 : 1);
    control.sourceStatus = 2;
    control.sessionStatus = 0;
    expect(control.headerStatus[0]()).toBe(connectionType === 'sync' ? 2 : 0);
    expect(control.contentProps).toHaveLength(1);
    expect(control.contentProps[0].doInitialSync).toBe(
      connectionType === 'sync' ? control.initialSync : undefined
    );
    expect(control.initialSync).not.toHaveBeenCalled();
  }
);
