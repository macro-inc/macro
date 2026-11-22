/** @vitest-environment jsdom */
import { cleanup, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, test, vi } from 'vitest';

// Block.tsx is this view's FE-70 entry: it alone picks the body popup
// composition by device and hands it to MarkdownDocument.

const control = vi.hoisted(() => ({
  touch: false,
  documentProps: [] as Record<string, unknown>[],
}));
const passthrough = (props: ParentProps) => props.children;
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => control.touch,
}));
vi.mock('../views/body-format-popup', () => ({
  desktopBodyFormatPopup: { device: 'desktop' },
}));
vi.mock('../views/mobile/body-format-popup', () => ({
  mobileBodyFormatPopup: { device: 'touch' },
}));
vi.mock('./MarkdownDocument', () => ({
  MarkdownDocument: (props: Record<string, unknown>) => {
    control.documentProps.push(props);
    return null;
  },
  MarkdownDocumentContent: () => null,
}));
vi.mock('@app/features/entity-appearance/queries/document-appearance', () => ({
  markdownEntityFromMetadata: () => undefined,
}));
vi.mock('@app/features/next-soup/actions', () => ({
  useBlockEntityCommands: () => {},
}));
vi.mock('@components/app/GlobalAppState', () => ({
  useGlobalNotificationSource: () => undefined,
}));
vi.mock('@components/app/side-panel', () => ({
  SidePanel: { Layout: passthrough },
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useCanAutofocusSplitContent: () => () => false,
}));
vi.mock('@components/app/useNavigatedFromJK', () => ({
  useNavigatedFromJK: () => ({ navigatedFromJK: () => false }),
}));
vi.mock('@core/block', () => ({
  useBlockAliasedName: () => 'md',
  useBlockId: () => 'document-1',
  useIsNestedBlock: () => true,
}));
vi.mock('@core/component/DocumentBlockContainer', () => ({
  DocumentBlockContainer: passthrough,
}));
vi.mock('@core/internal/BlockLoader', () => ({
  blockDataSignal: { get: () => undefined },
}));
vi.mock('@core/orchestrator', () => ({ createMethodRegistration: () => {} }));
vi.mock('@core/signal/blockElement', () => ({
  blockHotkeyScopeSignal: { get: () => undefined },
}));
vi.mock('@core/signal/load', () => ({
  blockErrorSignal: { set: () => {} },
  blockHandleSignal: { get: () => undefined },
  blockMetadataSignal: () => undefined,
  blockSourceSignal: { get: () => undefined },
}));
vi.mock('@core/signal/permissions', () => ({
  useCanComment: () => () => true,
  useCanEdit: () => () => true,
  useGetPermissions: () => () => 'owner',
  useIsDocumentOwner: () => () => true,
}));
vi.mock('@core/util/currentBlockDocumentName', () => ({
  useBlockDocumentName: () => () => 'Doc',
}));
vi.mock('@notifications', () => ({
  DocumentNotificationReadMarker: () => null,
}));
vi.mock('../context/markdown-document-state', () => ({
  createMarkdownDocumentState: () => ({
    params: { navigate: () => {} },
    session: { status: () => undefined },
  }),
}));
vi.mock('../primitives/create-markdown-route-navigation', () => ({
  createMarkdownRouteNavigation: () => {},
}));
vi.mock('../queries/markdown-document-operations', () => ({
  loadMarkdownCachedSnapshot: async () => undefined,
}));
vi.mock('../views/markdown-header', () => ({ MarkdownHeader: () => null }));
vi.mock('../views/mobile/markdown-header', () => ({
  MobileMarkdownHeader: () => null,
}));
vi.mock('./FindAndReplace', () => ({ FindAndReplace: () => null }));
vi.mock('./ModalsProvider', () => ({ ModalsProvider: passthrough }));
vi.mock('./sidepanel/MarkdownSidePanelSections', () => ({
  MarkdownSidePanelSections: () => null,
}));
vi.mock('./useTaskBranchNameHotkey', () => ({
  useTaskBranchNameHotkey: () => {},
}));

const { default: MarkdownBlockAdapter } = await import('./Block');

afterEach(() => {
  cleanup();
  control.documentProps.length = 0;
});

test.each([
  [false, 'desktop'],
  [true, 'touch'],
] as const)(
  'the markdown block entry on touch=%s hands MarkdownDocument the %s popup',
  (touch, device) => {
    control.touch = touch;
    render(() => <MarkdownBlockAdapter />);
    expect(control.documentProps).toHaveLength(1);
    expect(control.documentProps[0].bodyFormatPopup).toEqual({ device });
  }
);
