import { render, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import RustMarkdownEditor from './RustMarkdownEditor';

const control = vi.hoisted(() => ({
  create: vi.fn(),
  load: vi.fn(),
  canEdit: (): boolean => true,
  detachedError: vi.fn(),
  attrs: vi.fn(),
  afterProjection: vi.fn(),
  report: vi.fn(),
  status: vi.fn(),
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
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'fixture-user',
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
    permissions: { canEdit: () => control.canEdit() },
    state: {
      session: { setStatus: control.status },
      editor: { error: () => false },
      generation: {
        isGenerating: () => false,
        generatedAndWaiting: () => false,
      },
    },
  }),
}));
vi.mock('@macro-inc/observability', () => ({
  Telemetry: { error: control.report },
}));
vi.mock('@app/observability/editor', () => ({
  startEditorScrollTelemetry: () => () => {},
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingEquationMenu',
  () => ({ FloatingEquationMenu: () => null })
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
  FloatingMenuGroup: () => null,
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
    installNativeMarkdownOverlays: () => ({
      dispose() {},
      bindView() {},
      host: {},
      events: {},
    }),
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/editing/overlay-hosts/native-listeners',
  () => ({
    createNativeListenerScope: () => ({
      add() {},
      dispose() {},
      fail(error: unknown): never {
        throw error;
      },
    }),
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
vi.mock('@core/component/LexicalMarkdown/theme', () => ({ theme: {} }));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/util/fireAndForget', () => ({
  fireAndForget: (promise: Promise<unknown>) => {
    promise.catch(control.detachedError);
  },
}));
vi.mock('@core/util/platform', () => ({ isPlatform: () => false }));
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
  registerMacroDecoratorViews: () => ({}),
  registerMacroElementViews: (registry: unknown) => registry,
}));
vi.mock('@solid-primitives/platform', () => ({
  isAndroid: false,
  isAppleDevice: false,
  isFirefox: false,
  isIOS: false,
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
  const listeners = new Set<(commit: { fullReconcile: boolean }) => void>();
  const view = {
    setEditable: vi.fn(),
    focus: vi.fn(),
    node: () => (initialized ? {} : undefined),
    isEmpty: () => (initialized ? true : null),
    onCommit(listener: (commit: { fullReconcile: boolean }) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    view,
    close: vi.fn(async () => {}),
    initialize() {
      initialized = true;
      for (const listener of [...listeners]) listener({ fullReconcile: true });
    },
    unchanged() {
      for (const listener of [...listeners]) listener({ fullReconcile: false });
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  control.afterProjection.mockReset();
  control.load.mockResolvedValue({});
  control.canEdit = () => true;
});
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

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
  expect(exposed).toHaveBeenCalledWith(mounted);
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(true);
  setCanEdit(false);
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(false);
  setCanEdit(true);
  expect(mounted.view.setEditable).toHaveBeenLastCalledWith(true);
  rendered.unmount();
  expect(mounted.close).toHaveBeenCalledOnce();
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
  expect(exposed).toHaveBeenCalledWith(mounted);
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
    await waitFor(() => expect(exposed).toHaveBeenCalledWith(mounted));
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
  await waitFor(() => expect(exposed).toHaveBeenCalledWith(mounted));
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
