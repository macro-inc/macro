import 'fake-indexeddb/auto';
import { writeFileSync } from 'node:fs';
import { behaviorEditor } from '@core/component/LexicalMarkdown/behavior-inventory/editor';
import { trailingParagraphPlugin } from '@core/component/LexicalMarkdown/plugins/trailing-paragraph/trailingParagraphPlugin';
import { editorStateAsMarkdown } from '@core/component/LexicalMarkdown/utils';
import * as detachedWork from '@core/util/fireAndForget';
import { $createCodeNode } from '@lexical/code-core';
import { $createLinkNode } from '@lexical/link';
import { $createListItemNode, $createListNode } from '@lexical/list';
import { $createHeadingNode } from '@lexical/rich-text';
import { render } from '@solidjs/testing-library';
import type { LexicalEditor } from 'lexical';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
} from 'lexical';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type InputCommitFixture,
  initializeInputCommitFixture,
  mountInputCommitFixture,
} from '../../../../../../packages/lexical-wasm-view/src/view/input-commit-test-fixture';
import {
  useDispatchAgentAction,
  useDispatchAgentSplitFileActions,
} from './DispatchAgentMenu';

// Controlled hook fixture: both editors and their exporters are real. Only the
// surrounding document metadata, service replies and action sinks are supplied.
interface FixtureContext {
  documentId(): string;
  kind(): 'document' | 'task';
  state: {
    editor: {
      md: { editor?: LexicalEditor; nativeRuntime?: InputCommitFixture };
    };
  };
}
let context: FixtureContext | undefined;
const mocks = vi.hoisted(() => ({
  shortId: vi.fn(),
  branchName: vi.fn(),
  threads: vi.fn(),
  copy: vi.fn(),
  success: vi.fn(),
  failure: vi.fn(),
}));
vi.mock('@app/features/integrations/mcp-setup/MacroMcpSetupModal', () => ({
  openMacroMcpSetupModal: vi.fn(),
}));
vi.mock('@queries/messages/document-messages', () => ({
  fetchDocumentThreads: mocks.threads,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getDocumentShortId: mocks.shortId,
    getDocumentBranchName: mocks.branchName,
  },
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@core/util/branchName', () => ({
  copyBranchNameToClipboard: vi.fn(),
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => {
    if (!context) throw new Error('Missing controlled document context');
    return context;
  },
}));
vi.mock('./MarkdownNameProvider', () => ({
  useMarkdownName: () => ({ displayName: () => 'Prompt fixture' }),
}));

let restoreNative: (() => void) | undefined;
let clipboard: PropertyDescriptor | undefined;
const runtimes: InputCommitFixture[] = [];
const unmounts: (() => void)[] = [];
const evidence: object[] = [];
beforeAll(() => {
  restoreNative = initializeInputCommitFixture();
  clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copy },
  });
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.shortId.mockResolvedValue({ isOk: () => true, value: 'DOC-1' });
  mocks.branchName.mockResolvedValue({
    isOk: () => true,
    value: { shortId: 'TASK-1', branchName: 'work/fixture' },
  });
  mocks.threads.mockResolvedValue([]);
  mocks.copy.mockImplementation(async (prompt: string) => {
    evidence.push({ test: expect.getState().currentTestName, prompt });
  });
});
afterEach(async () => {
  let firstFailure: { error: unknown } | undefined;
  for (const unmount of unmounts.splice(0)) {
    try {
      unmount();
    } catch (error) {
      firstFailure ??= { error };
    }
  }
  for (const runtime of runtimes.splice(0)) {
    try {
      await runtime.close();
    } catch (error) {
      firstFailure ??= { error };
    }
    try {
      runtime.root.remove();
    } catch (error) {
      firstFailure ??= { error };
    }
  }
  context = undefined;
  try {
    vi.restoreAllMocks();
  } catch (error) {
    firstFailure ??= { error };
  }
  if (firstFailure !== undefined) throw firstFailure.error;
});
afterAll(() => {
  let firstFailure: { error: unknown } | undefined;
  try {
    restoreNative?.();
  } catch (error) {
    firstFailure ??= { error };
  }
  try {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
    else Reflect.deleteProperty(navigator, 'clipboard');
  } catch (error) {
    firstFailure ??= { error };
  }
  const output = process.env.DISPATCH_PROMPT_EVIDENCE;
  try {
    if (output)
      writeFileSync(
        output,
        JSON.stringify(
          {
            qualification:
              'Controlled actual-engine hook fixture; metadata and clipboard transport supplied, not an app or external-client gate',
            evidence,
          },
          null,
          2
        ) + '\n',
        { flag: 'wx', mode: 0o600 }
      );
  } catch (error) {
    firstFailure ??= { error };
  }
  if (firstFailure !== undefined) throw firstFailure.error;
});

function body(text: string, populate?: () => void) {
  const source = behaviorEditor(trailingParagraphPlugin());
  source.editor.update(
    () => {
      if (populate) populate();
      else
        $getRoot()
          .clear()
          .append($createParagraphNode().append($createTextNode(text)));
    },
    { discrete: true }
  );
  // Full actual model state keeps code children. The legacy DSS getSaveState
  // intentionally strips them and is not a same-body import fixture.
  const seed = JSON.stringify(source.editor.getEditorState().toJSON());
  const native = mountInputCommitFixture();
  runtimes.push(native);
  native.port.setState(seed);
  const sourceMarkdown = editorStateAsMarkdown(source.editor, 'external');
  const nativeMarkdown = native.executor.session.markdown(1);
  const nativeState = native.executor.session.serializedState();
  evidence.push({
    test: expect.getState().currentTestName,
    seed,
    sourceMarkdown,
    nativeMarkdown,
    nativeState,
  });
  // A serializer mismatch is a separate failure, never hidden by prompt shaping.
  expect(nativeMarkdown).toBe(sourceMarkdown);
  return { source, native, seed, sourceMarkdown, nativeMarkdown };
}

function actions(
  md: FixtureContext['state']['editor']['md'],
  kind: 'document' | 'task' = 'document'
) {
  context = {
    documentId: () => 'prompt-fixture',
    kind: () => kind,
    state: { editor: { md } },
  };
  let result: ReturnType<typeof useDispatchAgentAction> | undefined;
  let menu: ReturnType<typeof useDispatchAgentSplitFileActions> | undefined;
  const view = render(() => {
    result = useDispatchAgentAction();
    menu = useDispatchAgentSplitFileActions();
    return null;
  });
  unmounts.push(view.unmount);
  if (!result || !menu)
    throw new Error('Actual prompt hooks did not construct');
  return { ...result, menu };
}

for (const kind of ['document', 'task'] as const) {
  it(`copies identical ${kind} prompts from actual Source and native bodies`, async () => {
    const fixture = body('Body retained in prompt');
    const source = actions({ editor: fixture.source.editor }, kind);
    expect(await source.executeLastUsed()).toBe(true);
    const expected = mocks.copy.mock.calls.at(-1)?.[0];
    expect(expected).toContain(fixture.sourceMarkdown);
    expect(expected).toContain(
      kind === 'task' ? '<task-content>' : '<document-content>'
    );
    const native = actions({ nativeRuntime: fixture.native }, kind);
    expect(await native.executeLastUsed()).toBe(true);
    expect(mocks.copy.mock.calls.at(-1)?.[0]).toBe(expected);
    expect(mocks.success).not.toHaveBeenCalled();
  });
}

it('allows genuinely empty bodies from both actual engines', async () => {
  const fixture = body('');
  expect(fixture.sourceMarkdown).toBe('');
  expect(
    await actions({ editor: fixture.source.editor }).executeLastUsed()
  ).toBe(true);
  const expected = mocks.copy.mock.calls.at(-1)?.[0];
  expect(
    await actions({ nativeRuntime: fixture.native }).executeLastUsed()
  ).toBe(true);
  expect(mocks.copy.mock.calls.at(-1)?.[0]).toBe(expected);
  expect(expected).not.toContain('<document-content>');
});

it('builds an empty-content prompt when no body engine exists, as Source does', async () => {
  const hook = actions({});
  expect(hook.lastUsed().key).toBe('copy');
  expect(await hook.executeLastUsed()).toBe(true);
  expect(mocks.copy).toHaveBeenCalledOnce();
  expect(mocks.copy.mock.calls[0]?.[0]).not.toContain('<document-content>');
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(hook.lastUsed().key).toBe('copy');
});

for (const mode of ['null-root', 'detached-root']) {
  it(`reads a Source editor whether or not its root is attached (${mode})`, async () => {
    const fixture = body('Body without an attached root');
    if (mode === 'null-root') fixture.source.editor.setRootElement(null);
    else fixture.source.root.remove();
    expect(
      await actions({ editor: fixture.source.editor }).executeLastUsed()
    ).toBe(true);
    expect(mocks.copy.mock.calls.at(-1)?.[0]).toContain(
      'Body without an attached root'
    );
  });
}

it('prefers the actual native engine without reading a stale Source body', async () => {
  const fixture = body('Native body');
  fixture.source.editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Stale Source body'))
        );
    },
    { discrete: true }
  );
  const read = vi.spyOn(fixture.source.editor, 'read');
  const hook = actions({
    editor: fixture.source.editor,
    nativeRuntime: fixture.native,
  });
  expect(await hook.executeLastUsed()).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(mocks.copy.mock.calls.at(-1)?.[0]).toContain(fixture.nativeMarkdown);
  expect(mocks.copy.mock.calls.at(-1)?.[0]).not.toContain('Stale Source body');
});

it('reads the native model, not Source, after its view is retired', async () => {
  const fixture = body('Native body after its view');
  fixture.native.view.dispose();
  const read = vi.spyOn(fixture.source.editor, 'read');
  expect(
    await actions({
      editor: fixture.source.editor,
      nativeRuntime: fixture.native,
    }).executeLastUsed()
  ).toBe(true);
  expect(read).not.toHaveBeenCalled();
  expect(mocks.copy.mock.calls.at(-1)?.[0]).toContain(fixture.nativeMarkdown);
});

for (const thrown of [undefined, null, { marker: 'injected-export-fault' }]) {
  it(`reports an injected native export failure without an action (${String(thrown)})`, async () => {
    const fixture = body('Real model before injected export fault');
    vi.spyOn(fixture.native.executor.session, 'markdown').mockImplementation(
      () => {
        throw thrown;
      }
    );
    const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await actions({ nativeRuntime: fixture.native }).executeLastUsed()
    ).toBe(false);
    expect(mocks.copy).not.toHaveBeenCalled();
    expect(mocks.threads).not.toHaveBeenCalled();
    expect(reported.mock.calls[0]).toHaveLength(2);
    expect(reported.mock.calls[0]?.[1]).toBe(thrown);
  });
}

for (const kind of ['document', 'task'] as const) {
  it(`preserves rich external markdown and full comments in ${kind} prompts`, async () => {
    const fixture = body('rich', () => {
      $getRoot()
        .clear()
        .append(
          $createHeadingNode('h2').append($createTextNode('Heading')),
          $createParagraphNode().append(
            $createTextNode('bold').setFormat('bold'),
            $createTextNode(' and '),
            $createLinkNode('https://example.com/context').append(
              $createTextNode('link')
            ),
            $createLineBreakNode(),
            $createTextNode('second line')
          ),
          $createListNode('bullet').append(
            $createListItemNode().append($createTextNode('item'))
          ),
          $createCodeNode('rust').append($createTextNode('let value = 1;'))
        );
    });
    const threads = [
      {
        state: { root_id: 'thread-a' },
        root: { content: 'Earlier comment', sender_id: 'fixture-author' },
        replies: [],
      },
      {
        state: { root_id: 'thread-b' },
        root: { content: 'Later comment', sender_id: 'fixture-author' },
        replies: [
          { content: 'Retained reply', sender_id: 'fixture-author' },
          {
            content: 'Deleted reply',
            sender_id: 'fixture-author',
            deleted_at: '2000-01-01',
          },
        ],
      },
    ];
    mocks.threads.mockImplementation(async () => structuredClone(threads));
    const source = actions({ editor: fixture.source.editor }, kind);
    expect(await source.executeLastUsed()).toBe(true);
    const expected = mocks.copy.mock.calls.at(-1)?.[0];
    expect(expected).toContain(fixture.sourceMarkdown);
    expect(expected).toContain('**bold**');
    expect(expected).toContain('[link](https://example.com/context)');
    expect(expected).toContain('```rust');
    expect(expected).toContain('Retained reply');
    expect(expected).not.toContain('Deleted reply');
    if (typeof expected !== 'string')
      throw new Error('Missing actual Source prompt');
    expect(expected.indexOf('thread-b')).toBeLessThan(
      expected.indexOf('thread-a')
    );
    expect(
      await actions({ nativeRuntime: fixture.native }, kind).executeLastUsed()
    ).toBe(true);
    expect(mocks.copy.mock.calls.at(-1)?.[0]).toBe(expected);
  });
}

for (const engine of ['source', 'native']) {
  it(`captures ${engine} body before delayed message metadata`, async () => {
    const fixture = body('Body before metadata');
    let release: ((value: never[]) => void) | undefined;
    const pending = new Promise<never[]>((resolve) => {
      release = resolve;
    });
    const completeMetadata = release;
    if (!completeMetadata)
      throw new Error('Missing actual metadata completion');
    mocks.threads.mockReturnValueOnce(pending);
    const hook = actions(
      engine === 'source'
        ? { editor: fixture.source.editor }
        : { nativeRuntime: fixture.native }
    );
    const result = hook.executeLastUsed();
    try {
      expect(mocks.threads).toHaveBeenCalledOnce();
      fixture.source.editor.update(
        () => {
          $getRoot()
            .clear()
            .append(
              $createParagraphNode().append(
                $createTextNode('Body after metadata')
              )
            );
        },
        { discrete: true }
      );
      if (engine === 'native')
        fixture.native.port.setState(
          JSON.stringify(fixture.source.editor.getEditorState().toJSON())
        );
    } finally {
      completeMetadata([]);
    }
    expect(await result).toBe(true);
    expect(mocks.copy.mock.calls.at(-1)?.[0]).toContain('Body before metadata');
    expect(mocks.copy.mock.calls.at(-1)?.[0]).not.toContain(
      'Body after metadata'
    );
  });
}

for (const platform of [
  {
    key: 'claude-code',
    label: 'Claude Code Web',
    prefix: 'https://claude.ai/code',
    parameter: 'q',
  },
  {
    key: 'codex-desktop',
    label: 'Codex Desktop',
    prefix: 'codex://new',
    parameter: 'prompt',
  },
  {
    key: 'cursor',
    label: 'Cursor',
    prefix: 'cursor://anysphere.cursor-deeplink/prompt',
    parameter: 'text',
  },
  { key: 'zed', label: 'Zed', prefix: 'zed://agent', parameter: 'prompt' },
]) {
  it(`emits the exact prompt and preserves real last-used success policy (${platform.key})`, async () => {
    const fixture = body('Platform body');
    const source = actions({ editor: fixture.source.editor }, 'task');
    const native = actions({ nativeRuntime: fixture.native }, 'task');
    const emitted = vi.spyOn(window, 'open').mockImplementation(() => null);
    const original = detachedWork.fireAndForget;
    const issued: Promise<unknown>[] = [];
    vi.spyOn(detachedWork, 'fireAndForget').mockImplementation(
      (work, surface) => {
        // The real public split-menu action owns this actual promise. Capture it
        // without replacing its outcome or waiting through arbitrary timers.
        if (surface === 'dispatch-agent') issued.push(Promise.resolve(work));
        original(work, surface);
      }
    );
    const invoke = async (action: (() => void) | undefined) => {
      if (!action) throw new Error('Missing actual split-menu action');
      const before = issued.length;
      action();
      expect(issued.length).toBe(before + 1);
      const pending = issued.at(-1);
      if (!pending) throw new Error('Missing actual action promise');
      return pending;
    };
    const sourceAction = source.menu.all.find(
      (row) => row.label === platform.label
    );
    const nativeAction = native.menu.all.find(
      (row) => row.label === platform.label
    );
    let firstFailure: { error: unknown } | undefined;
    try {
      expect(await invoke(sourceAction?.action)).toBe(true);
      const sourceUrl = emitted.mock.calls.at(-1)?.[0];
      expect(typeof sourceUrl).toBe('string');
      expect(await invoke(nativeAction?.action)).toBe(true);
      expect(emitted.mock.calls.at(-1)).toEqual([sourceUrl, '_blank']);
      if (typeof sourceUrl !== 'string')
        throw new Error('Missing actual launch URL');
      expect(sourceUrl.startsWith(platform.prefix)).toBe(true);
      expect(new URL(sourceUrl).searchParams.get(platform.parameter)).toContain(
        fixture.nativeMarkdown
      );
      expect(native.lastUsed().key).toBe(platform.key);
      const saved = localStorage.getItem('dispatch-agent-last-used');
      expect(saved).toBe(JSON.stringify(platform.key));

      emitted.mockClear();
      expect(await native.executeLastUsed()).toBe(true);
      expect(emitted.mock.calls).toEqual([[sourceUrl, '_blank']]);
      expect(mocks.success).not.toHaveBeenCalled();

      // A different real catalog action fails at its supplied open sink. The
      // selected persisted action must stay on the last successful platform.
      const other = native.menu.all.find(
        (row) => row.label === (platform.key === 'cursor' ? 'Zed' : 'Cursor')
      );
      const fault = { marker: 'injected-open-fault' };
      emitted.mockImplementationOnce(() => {
        throw fault;
      });
      const reported = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(await invoke(other?.action)).toBe(false);
      expect(reported.mock.calls.at(-1)?.[1]).toBe(fault);
      expect(native.lastUsed().key).toBe(platform.key);
      expect(localStorage.getItem('dispatch-agent-last-used')).toBe(saved);
      expect(mocks.failure).toHaveBeenCalledWith('Failed to generate prompt');
    } catch (error) {
      firstFailure = { error };
    } finally {
      // Reset the actual shared signal through its real copy action, not a
      // localStorage write that the already-created hook never reads. A copy
      // row returns its promise to the menu's copy item, which shows the
      // feedback, instead of issuing detached work.
      try {
        const copy = native.menu.copyAsPrompt;
        expect(copy.copy).toBe(true);
        const before = issued.length;
        const copied = copy.action?.();
        expect(issued.length).toBe(before);
        expect(await copied).toBe(true);
        expect(native.lastUsed().key).toBe('copy');
      } catch (error) {
        firstFailure ??= { error };
      }
    }
    if (firstFailure !== undefined) throw firstFailure.error;
  });
}
