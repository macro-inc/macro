import { runInNewContext } from 'node:vm';
import macroPlatformSource from '@core/constant/isMac?raw';
import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RustMarkdownEditor from './RustMarkdownEditor';

const control = vi.hoisted(() => ({
  platform: '',
  userAgent: '',
  ios: false,
  android: false,
  nativePlatform: '',
  create: vi.fn(),
  load: vi.fn(),
  canEdit: (): boolean => true,
  detachedError: vi.fn(),
  attrs: vi.fn(),
  afterProjection: vi.fn(),
  report: vi.fn(),
  status: vi.fn(),
  overlays: vi.fn(),
  gifRequestOpen: vi.fn(() => true),
  gifBindView: vi.fn(),
  gifDispose: vi.fn(),
  gifHost: { gif: 'host' },
  gifMenu: vi.fn(),
  decorators: vi.fn(),
  bookingDispose: vi.fn(),
  bookingView: () => null,
  resolveAppLink: vi.fn(),
  md: {} as Record<string, unknown>,
  setMd: vi.fn(),
  findAndReplace: {
    searchIsOpen: false,
    searchInputText: '',
    listOffset: [],
    styles: [],
    currentMatch: -1,
  },
  versionError: vi.fn(),
  textPaste: vi.fn(),
  textPasteRelease: vi.fn(),
}));
vi.mock('@app/observability/flow', () => ({
  useFlow: () => ({
    span: { setAttr() {} },
    task: async (name: string, run: (span: object) => unknown) => {
      const value = await run({ setAttr: control.attrs });
      if (name === 'editor.initial-projection') control.afterProjection();
      return value;
    },
  }),
}));
vi.mock('@property/tags', () => ({
  useDocTags: () => ({
    isApplied: () => false,
    applyTag: async () => {},
  }),
}));
vi.mock('./format-host/native-overlay', () => ({
  createNativeBodyFormattingOverlay: () => ({
    observer: {
      published() {},
      unavailable() {},
      retired() {},
    },
    dispose() {},
    Overlay: () => null,
  }),
}));
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-tag-mention-host',
  () => ({
    createNativeTagMentionContext: () => ({ dispose() {} }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-tag-mention-views',
  () => ({ createNativeTagMentionViews: () => ({}) })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-booking-views',
  () => ({
    createNativeBookingLinkMentionContext: () => ({
      dispose: control.bookingDispose,
      bindView() {},
      host: {},
    }),
    createNativeBookingLinkMentionViews: () => ({
      'booking-link-mention': control.bookingView,
    }),
  })
);
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => control.resolveAppLink,
}));
vi.mock('@core/component/LexicalMarkdown/plugins/text-paste/native', () => ({
  registerNativeTextPaste: (...args: unknown[]) => {
    control.textPaste(...args);
    return control.textPasteRelease;
  },
}));
vi.mock('@app/lib/analytics/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@app/lib/analytics/posthog')>()),
  // The inline-ai-editing flag (RustMarkdownEditor's AI edit slot). This shell
  // mounts no PosthogProvider; the slot stays off, as without the flag.
  useFeatureFlag: () => () => ({
    enabled: false,
    payload: undefined,
    loading: false,
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'fixture-user',
  useIsAuthenticated: () => () => true,
}));
vi.mock('@core/document-session/load', () => ({
  loadDocumentSession: control.load,
}));
vi.mock('../primitives/create-rust-editor-session', () => ({
  createRustEditorSession: control.create,
}));
vi.mock('../queries/editor-authorization', () => ({
  createEditorAuthorization: () => ({
    user: 'fixture-user',
    access: 2,
    auth: {},
  }),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'fixture-document',
    kind: () => 'document',
    bodyFormatPopup: () => ({ available: () => false, Popup: () => null }),
    permissions: { canEdit: () => control.canEdit() },
    state: {
      session: { setStatus: control.status },
      editor: {
        error: () => false,
        setError: control.versionError,
        md: control.md,
        setMd: (key: string, value: unknown) => {
          control.md[key] = value;
          control.setMd(key, value);
        },
        findAndReplace: control.findAndReplace,
        setFindAndReplace: vi.fn(),
        setFindListOffset: vi.fn(),
      },
      generation: {
        isGenerating: () => false,
        generatedAndWaiting: () => false,
      },
    },
  }),
}));
vi.mock('@macro-inc/observability', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@macro-inc/observability')>()),
  Telemetry: { error: control.report },
}));
// Readiness-shell controls isolate optional overlays; native checklist behavior
// is exercised separately against the actual generated module and real view.
vi.mock(
  '@core/component/LexicalMarkdown/component/task-list/NativeTaskListControls',
  () => ({
    NativeChecklistFacts: () => null,
    NativeChecklistOverlay: () => null,
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/plugins/checklist-controls/native-plan-host',
  () => ({
    createNativeChecklistPlanHost: () => ({
      observer: { published() {}, unavailable() {}, retired() {} },
      ready() {},
      dispose() {},
    }),
  })
);
vi.mock('@app/observability/editor', () => ({
  startEditorScrollTelemetry: () => () => {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingEquationMenu',
  () => ({ FloatingEquationMenu: () => null })
);
// Git blame is always on; its hover listeners and tooltip query need a real
// view root and blame data, which these tests don't serve.
vi.mock('@core/component/LexicalMarkdown/plugins/blame-tooltip/native', () => ({
  registerNativeBlameTooltip: () => () => {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/plugins/blame-tooltip',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@core/component/LexicalMarkdown/plugins/blame-tooltip')
    >()),
    BlameTooltip: () => null,
  })
);
vi.mock('@core/component/LexicalMarkdown/context/DecoratorHostContext', () => ({
  DecoratorHostContext: {
    Provider: (props: { children?: import('solid-js').JSX.Element }) =>
      props.children,
  },
}));
vi.mock('@core/component/LexicalMarkdown/context/editor-namespace', () => ({
  allocateEditorNamespace: () => 'readiness-test',
}));
vi.mock('@core/component/LexicalMarkdown/context/FloatingMenuContext', () => ({
  FloatingMenuGroup: (props: { children?: import('solid-js').JSX.Element }) =>
    props.children,
}));
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/fast-cached-views',
  () => ({
    createNativeFastCachedDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/fast-contact-views',
  () => ({
    createNativeFastContactDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/fast-html-views',
  () => ({
    createNativeFastHTMLDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/fast-selection-views',
  () => ({
    createNativeFastSelectionDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/fast-static-views',
  () => ({
    createNativeFastStaticDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-contact-host',
  () => ({
    createNativeContactContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-diff-insert-host',
  () => ({
    createNativeDiffInsertContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-diff-insert-views',
  () => ({
    createNativeDiffInsertViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-diff-view',
  () => ({
    createNativeDiffElementView: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-document-card-host',
  () => ({
    createNativeDocumentCardContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);

vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-document-card-views',
  () => ({
    createNativeDocumentCardViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);

vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-document-mention-host',
  () => ({
    createNativeDocumentMentionContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);

vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-agent-session-mention-host',
  () => ({
    createNativeAgentSessionMentionContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-agent-session-mention-views',
  () => ({
    createNativeAgentSessionMentionViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-database-query-host',
  () => ({
    createNativeDatabaseQueryContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-database-query-views',
  () => ({
    createNativeDatabaseQueryViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-date-mention-host',
  () => ({
    createNativeDateMentionContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-date-mention-views',
  () => ({
    createNativeDateMentionViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-paste-node-host',
  () => ({
    createNativePasteNodeContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-paste-node-views',
  () => ({
    createNativePasteNodeViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-document-mention-views',
  () => ({
    createNativeDocumentMentionViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-equation-host',
  () => ({
    createNativeEquationContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-equation-views',
  () => ({
    createNativeEquationViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-horizontal-rule',
  () => ({
    createNativeHorizontalRuleViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-image-host',
  () => ({
    createNativeImageContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-image-views',
  () => ({
    createNativeImageDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-magic-host',
  () => ({
    createNativeMagicDecoratorContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-pr-mention-views',
  () => ({
    createNativePullRequestMentionContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
    createNativePullRequestMentionViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-selection-host',
  () => ({
    createNativeSelectionDecoratorContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-snapshot-views',
  () => ({
    createNativeSnapshotContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
    createNativeSnapshotViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-user-mention-host',
  () => ({
    createNativeUserMentionContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-user-mention-views',
  () => ({
    createNativeUserMentionViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/decorator-host/native-video-views',
  () => ({
    createNativeVideoContext: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
    createNativeVideoDecoratorViews: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/installNativeMarkdownOverlays',
  () => ({
    installNativeMarkdownOverlays: (_view: unknown, options: unknown) => {
      control.overlays(options);
      return { dispose() {}, bindView() {}, host: {}, events: {} };
    },
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners',
  () => ({
    createNativeListenerScope: () => {
      const disposers: Array<() => void> = [];
      return {
        add(dispose: () => void) {
          disposers.push(dispose);
        },
        dispose() {
          for (const dispose of disposers.splice(0).reverse()) dispose();
        },
        fail(error: unknown): never {
          throw error;
        },
      };
    },
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/plugins/media/native-image-upload',
  () => ({
    createNativeImageUploadController: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/plugins/code/native-code-highlight-dom',
  () => ({ installNativeCodeChrome: () => () => {} })
);
vi.mock(
  '@core/component/LexicalMarkdown/plugins/code/native-accessory',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@core/component/LexicalMarkdown/plugins/code/native-accessory')
    >()),
    createNativeCodeAccessories: () => ({
      store: {},
      refreshEditable() {},
      dispose() {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer',
  () => ({ NodeAccessoryLayer: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/overlay-hosts/native-gif',
  () => ({
    createNativeGifContext: () => ({
      host: control.gifHost,
      requestOpen: control.gifRequestOpen,
      bindView: control.gifBindView,
      dispose: control.gifDispose,
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingGifMenu',
  () => ({
    HostedFloatingGifMenu: (props: unknown) => {
      control.gifMenu(props);
      return null;
    },
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/core/NativeLocationHighlight',
  () => ({ NativeLocationHighlight: () => null })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/overlay-hosts/native-creation',
  () => ({
    createNativeCreationComposerController: () => ({
      dispose() {},
      requestCreation: () => false,
    }),
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({ theme: {} }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (promise: Promise<unknown>) => {
    promise.catch(control.detachedError);
  },
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: (platform: string) => control.nativePlatform === platform,
}));
vi.mock('@core/constant/isMac', () => ({
  get IS_MAC() {
    return runInNewContext(
      macroPlatformSource.replace('export const IS_MAC', 'const IS_MAC') +
        '\nIS_MAC',
      {
        navigator: { platform: control.platform, userAgent: control.userAgent },
      }
    );
  },
}));
vi.mock('@macro-inc/collaboration/collab/source', () => ({
  SyncSourceStatus: {
    Connected: 'connected',
    Connecting: 'connecting',
    Disconnected: 'disconnected',
  },
}));
vi.mock('@macro-inc/lexical-wasm-view', () => ({
  createBuiltinRegistry: () => ({
    replace() {
      return this;
    },
  }),
  registerMacroDecoratorViews: (_registry: unknown, decorators: unknown) => {
    control.decorators(decorators);
    return {};
  },
  registerMacroElementViews: (registry: unknown) => registry,
}));
vi.mock('@solid-primitives/platform', () => ({
  get isAndroid() {
    return control.android;
  },
  get isAppleDevice() {
    return (
      control.ios ||
      /macintosh|macintel|macppc|mac68k|macos/i.test(control.userAgent)
    );
  },
  isFirefox: false,
  get isIOS() {
    return control.ios;
  },
  isSafari: false,
}));

const context = {
  syncService: true as const,
  fromCache: false,
  documentMetadata: {
    documentId: 'fixture-document',
    documentName: 'Fixture',
    documentVersionId: 1,
    owner: 'fixture-user',
    fileType: 'md',
  },
  userAccessLevel: 'edit' as const,
};

function session() {
  let initialized = false;
  const listeners = new Set<
    (commit: { fullReconcile: boolean; keys: number[] }) => void
  >();
  const versionListeners = new Set<() => void>();
  const view = {
    onPluginEvent(name: string, listener: () => void) {
      if (name === 'group-b.document-version-error')
        versionListeners.add(listener);
      return () => versionListeners.delete(listener);
    },
    setEditable: vi.fn(),
    focus: vi.fn(),
    node: () => (initialized ? {} : undefined),
    isEmpty: () => (initialized ? true : null),
    registerViewCommand: () => () => {},
    onCommit(
      listener: (commit: { fullReconcile: boolean; keys: number[] }) => void
    ) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    view,
    close: vi.fn(async () => {}),
    versionError() {
      for (const listener of [...versionListeners]) listener();
    },
    initialize() {
      initialized = true;
      for (const listener of [...listeners])
        listener({ fullReconcile: true, keys: [0] });
    },
    unchanged() {
      for (const listener of [...listeners])
        listener({ fullReconcile: false, keys: [] });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(control.md)) delete control.md[key];
  control.platform = '';
  control.userAgent = '';
  control.ios = false;
  control.android = false;
  control.nativePlatform = '';
  control.afterProjection.mockReset();
  control.load.mockResolvedValue({});
  control.canEdit = () => true;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

/** The runtime the editor publishes: the session plus its native pin store. */
function published(mounted: object) {
  return {
    ...mounted,
    pinnedProperties: expect.objectContaining({ read: expect.any(Function) }),
  };
}

it('keeps a pending view private and noneditable until Initialize, then follows live access', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const [canEdit, setCanEdit] = createSignal(true);
  control.canEdit = canEdit;
  const exposed = vi.fn();
  const ready = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
    />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(mounted.view.setEditable).toHaveBeenCalledWith(false)
  );
  expect(control.create.mock.calls[0][0].view.editable).toBe(false);
  expect(exposed).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  mounted.unchanged();
  expect(exposed).not.toHaveBeenCalled();
  mounted.initialize();
  await waitFor(() => expect(ready).toHaveBeenCalledOnce());
  expect(exposed).toHaveBeenCalledWith(published(mounted));
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(true);
  setCanEdit(false);
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(false);
  setCanEdit(true);
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(true);
  rendered.unmount();
  expect(mounted.close).toHaveBeenCalledOnce();
});

it('registers the booking-link mention view so documents containing one open', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.decorators).toHaveBeenCalledOnce());
  expect(control.decorators.mock.calls[0][0]).toHaveProperty(
    'booking-link-mention',
    control.bookingView
  );
  rendered.unmount();
  expect(control.bookingDispose).toHaveBeenCalledOnce();
});

it('resolves pasted Macro and PR links through the app resolver until unmount', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.textPaste).toHaveBeenCalledOnce());
  expect(control.textPaste).toHaveBeenCalledWith(
    mounted.view,
    control.resolveAppLink
  );
  expect(control.textPasteRelease).not.toHaveBeenCalled();
  rendered.unmount();
  expect(control.textPasteRelease).toHaveBeenCalledOnce();
});

it('publishes the native find engine to the find bar until unmount', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() =>
    expect(control.setMd).toHaveBeenCalledWith(
      'documentFind',
      expect.objectContaining({
        search: expect.any(Function),
        replaceAll: expect.any(Function),
        replaceOnce: expect.any(Function),
      })
    )
  );
  rendered.unmount();
  expect(control.md.documentFind).toBeUndefined();
});

it('publishes native word count and progress stores until unmount', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  expect(control.md.wordcountStats).toMatchObject({ totalWords: 0 });
  expect(control.md.progressStats).toMatchObject({ completed: 0, total: 0 });
  expect(control.create.mock.calls[0][0].latestPublished).toHaveLength(4);
  rendered.unmount();
  expect(control.md.wordcountStats).toBeUndefined();
  expect(control.md.progressStats).toBeUndefined();
});

it('reports an attach error that arrives before the async mount returns without publishing or waiting forever', async () => {
  const mounted = session();
  const failure = new Error('projection diverged: attach synced JSON differs');
  control.create.mockImplementation(async (options) => {
    options.view.onError(failure);
    return mounted;
  });
  const exposed = vi.fn();
  const ready = vi.fn();
  const error = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
      onError={error}
    />
  ));
  await waitFor(() => expect(error).toHaveBeenCalledOnce());
  await waitFor(() => expect(control.report).toHaveBeenCalledOnce());
  expect(error).toHaveBeenCalledWith(failure);
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  expect(mounted.view.setEditable).not.toHaveBeenCalledWith(true);
  await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
  rendered.unmount();
});

it('closes an unmounted pending view without exposing it after a late Initialize', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  rendered.unmount();
  mounted.initialize();
  await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
});

it('does not publish if an error follows Initialize before its await continuation', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  const error = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
      onError={error}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  mounted.initialize();
  control.create.mock.calls[0][0].view.onError(
    new Error('attach failed after output')
  );
  await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  expect(error).toHaveBeenCalledOnce();
  rendered.unmount();
});

it('reports the original open error even if withdrawing the public handle throws', async () => {
  const mounted = session();
  const failure = new Error('attach failed');
  control.create.mockImplementation(async (options) => {
    options.view.onError(failure);
    return mounted;
  });
  const error = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={() => {
        throw null;
      }}
      onError={error}
    />
  ));
  await waitFor(() => expect(error).toHaveBeenCalledWith(failure));
  expect(control.report).toHaveBeenCalledWith(null, {
    surface: 'rust-editor.runtime.cleanup',
  });
  rendered.unmount();
});

it('keeps the view private through the reconnect budget and publishes a late Initialize', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  const error = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
      onError={error}
    />
  ));
  await vi.advanceTimersByTimeAsync(0);
  const status = control.create.mock.calls[0][0].onStatus;
  await vi.advanceTimersByTimeAsync(15_000);
  status({ code: 2 });
  await vi.advanceTimersByTimeAsync(8_000);
  status({ code: 0 });
  expect(error).not.toHaveBeenCalled();
  expect(mounted.close).not.toHaveBeenCalled();
  expect(exposed).not.toHaveBeenCalled();
  expect(mounted.view.setEditable).not.toHaveBeenCalledWith(true);
  expect(control.attrs).toHaveBeenCalledWith('editor.open.phase', 'retrying');
  mounted.initialize();
  await vi.advanceTimersByTimeAsync(0);
  expect(ready).toHaveBeenCalledOnce();
  expect(exposed).toHaveBeenCalledWith(published(mounted));
  expect(control.attrs).toHaveBeenCalledWith(
    'editor.open.phase',
    'initialized'
  );
  rendered.unmount();
});

it('reports exhausted native retries and closes without replaying a late Initialize', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  const error = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
      onError={error}
    />
  ));
  await vi.advanceTimersByTimeAsync(0);
  control.create.mock.calls[0][0].onStatus({ code: 3 });
  await vi.advanceTimersByTimeAsync(0);
  expect(error).toHaveBeenCalledOnce();
  expect(error.mock.calls[0][0].message).toBe(
    'Editor connection retries exhausted'
  );
  expect(control.attrs).toHaveBeenCalledWith(
    'editor.open.phase',
    'retries-exhausted'
  );
  expect(mounted.close).toHaveBeenCalledOnce();
  mounted.initialize();
  await vi.advanceTimersByTimeAsync(0);
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  rendered.unmount();
});

it.each([3, 4])(
  'observes terminal status %i delivered during construction before the projection wait',
  async (code) => {
    const mounted = session();
    control.create.mockImplementation(async (options) => {
      options.onStatus({ code });
      return mounted;
    });
    const error = vi.fn();
    const exposed = vi.fn();
    const rendered = render(() => (
      <RustMarkdownEditor
        context={context}
        autoFocus={false}
        onRuntime={exposed}
        onError={error}
      />
    ));
    await waitFor(() => expect(error).toHaveBeenCalledOnce());
    expect(error.mock.calls[0][0].message).toBe(
      code === 3
        ? 'Editor connection retries exhausted'
        : 'Editor connection closed before initialization'
    );
    await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
    expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(
      true
    );
    rendered.unmount();
  }
);

it.each([3, 4])(
  'publishes an already initialized cached root despite connection status %i',
  async (code) => {
    const mounted = session();
    mounted.initialize();
    control.create.mockImplementation(async (options) => {
      options.onStatus({ code });
      return mounted;
    });
    const error = vi.fn();
    const exposed = vi.fn();
    const rendered = render(() => (
      <RustMarkdownEditor
        context={context}
        autoFocus={false}
        onRuntime={exposed}
        onError={error}
      />
    ));
    await waitFor(() =>
      expect(exposed).toHaveBeenCalledWith(published(mounted))
    );
    expect(error).not.toHaveBeenCalled();
    expect(mounted.close).not.toHaveBeenCalled();
    rendered.unmount();
  }
);

it('retains initialized content when retries end during or after the Initialize continuation', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const error = vi.fn();
  const exposed = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onError={error}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  mounted.initialize();
  control.create.mock.calls[0][0].onStatus({ code: 3 });
  await waitFor(() => expect(exposed).toHaveBeenCalledWith(published(mounted)));
  control.create.mock.calls[0][0].onStatus({ code: 3 });
  expect(error).not.toHaveBeenCalled();
  expect(mounted.close).not.toHaveBeenCalled();
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(true);
  rendered.unmount();
});

it('does not publish if enabling the view reentrantly reports an error', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  mounted.view.setEditable.mockImplementation((editable) => {
    if (editable)
      control.create.mock.calls[0][0].view.onError(
        new Error('listener failed')
      );
  });
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  mounted.initialize();
  await waitFor(() => expect(control.report).toHaveBeenCalled());
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  rendered.unmount();
});

it('does not announce ready if publishing reentrantly reports an error', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const ready = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={(runtime) => {
        if (runtime)
          control.create.mock.calls[0][0].view.onError(
            new Error('consumer failed')
          );
      }}
      onReady={ready}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  mounted.initialize();
  await waitFor(() => expect(control.report).toHaveBeenCalled());
  expect(ready).not.toHaveBeenCalled();
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(false);
  rendered.unmount();
});

it('keeps failure final across the asynchronous flow wrapper boundary', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const exposed = vi.fn();
  const ready = vi.fn();
  control.afterProjection.mockImplementation(() =>
    control.create.mock.calls[0][0].view.onError(
      new Error('error between flow continuations')
    )
  );
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onRuntime={exposed}
      onReady={ready}
    />
  ));
  await waitFor(() => expect(mounted.view.setEditable).toHaveBeenCalled());
  mounted.initialize();
  await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
  expect(mounted.view.setEditable).not.toHaveBeenCalledWith(true);
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(ready).not.toHaveBeenCalled();
  rendered.unmount();
});

it.each([
  ['MacIntel', 'Windows NT 10.0', false, false, '', 1],
  ['Linux x86_64', 'Macintosh; Intel Mac OS X', false, false, '', 1],
  ['Linux x86_64', 'X11; Linux x86_64', false, false, '', 0],
  ['iPhone', 'iPhone', true, false, '', 2],
  ['Linux armv8l', 'Android', false, true, '', 3],
  ['MacIntel', 'Android', false, true, '', 3],
  ['MacIntel', 'Windows NT 10.0', false, false, 'ios', 2],
  ['MacIntel', 'Windows NT 10.0', false, false, 'android', 3],
])(
  'configures native view OS for platform %s / UA %s / iOS %s / Android %s / native %s',
  async (platform, userAgent, ios, android, nativePlatform, expected) => {
    control.platform = platform;
    control.userAgent = userAgent;
    control.ios = ios;
    control.android = android;
    control.nativePlatform = nativePlatform;
    const mounted = session();
    control.create.mockResolvedValue(mounted);
    const rendered = render(() => (
      <RustMarkdownEditor context={context} autoFocus={false} />
    ));
    await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
    expect(control.create.mock.calls[0][0].viewOs).toBe(expected);
    rendered.unmount();
    await waitFor(() => expect(mounted.close).toHaveBeenCalledOnce());
  }
);

it('passes the Source Prism code tokenizer into the native session (code highlighting on)', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  const options = control.create.mock.calls[0][0];
  expect(typeof options.codeTokens?.provider).toBe('function');
  expect(options.codeTokens?.profile).toBe('@lexical/code-prism@0.45.0');
  // The provider answers the language check as Source's isCodeLanguageLoaded does.
  expect(
    JSON.parse(
      options.codeTokens.provider(
        'loaded',
        'javascript',
        '',
        options.codeTokens.profile
      )
    )
  ).toEqual({ kind: 'loaded', loaded: true });
  rendered.unmount();
});

it('wires the native GIF picker: slash request, post-projection bind, hosted menu, disposal', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  control.create.mock.calls[0][0].installOverlays(mounted.view);
  const [options] = control.overlays.mock.calls[0] ?? [];
  const actions =
    options && typeof options === 'object' && 'actions' in options
      ? options.actions
      : undefined;
  const requestGif =
    actions && typeof actions === 'object' && 'requests' in actions
      ? Reflect.get(Object(actions.requests), 'requestGif')
      : undefined;
  expect(typeof requestGif).toBe('function');
  expect(control.gifBindView).not.toHaveBeenCalled();
  mounted.initialize();
  await waitFor(() =>
    expect(control.gifBindView).toHaveBeenCalledWith(mounted.view)
  );
  if (typeof requestGif === 'function') expect(requestGif()).toBe(true);
  expect(control.gifRequestOpen).toHaveBeenCalledOnce();
  await waitFor(() => expect(control.gifMenu).toHaveBeenCalled());
  expect(control.gifMenu.mock.lastCall?.[0]).toMatchObject({
    host: control.gifHost,
    portalScope: 'global',
  });
  rendered.unmount();
  await waitFor(() => expect(control.gifDispose).toHaveBeenCalledOnce());
});

it('observes newer document versions through the mounted body lifecycle', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  const installed = control.create.mock.calls[0][0].installOverlays(
    mounted.view
  );
  mounted.versionError();
  expect(control.versionError).toHaveBeenCalledWith('VERSION_MISMATCH_ERROR');
  control.versionError.mockClear();
  installed.dispose();
  mounted.versionError();
  expect(control.versionError).not.toHaveBeenCalled();
  rendered.unmount();
});

it('retains a newer-version read-only presentation without publishing readiness', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const ready = vi.fn();
  const exposed = vi.fn();
  const rendered = render(() => (
    <RustMarkdownEditor
      context={context}
      autoFocus={false}
      onReady={ready}
      onRuntime={exposed}
    />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  control.create.mock.calls[0][0].view.onError(
    new Error('VERSION_MISMATCH_ERROR')
  );
  mounted.initialize();
  await Promise.resolve();
  await Promise.resolve();
  expect(mounted.close).not.toHaveBeenCalled();
  expect(control.versionError).toHaveBeenCalledWith('VERSION_MISMATCH_ERROR');
  expect(ready).not.toHaveBeenCalled();
  expect(exposed.mock.calls.every(([value]) => value === undefined)).toBe(true);
  expect(mounted.view.setEditable).not.toHaveBeenCalledWith(true);
  rendered.unmount();
});

it('does not write a version error from a retired document runtime', async () => {
  const mounted = session();
  control.create.mockResolvedValue(mounted);
  const rendered = render(() => (
    <RustMarkdownEditor context={context} autoFocus={false} />
  ));
  await waitFor(() => expect(control.create).toHaveBeenCalledOnce());
  const notifyError = control.create.mock.calls[0][0].view.onError;
  rendered.unmount();
  notifyError(new Error('VERSION_MISMATCH_ERROR'));
  expect(control.versionError).not.toHaveBeenCalled();
});
