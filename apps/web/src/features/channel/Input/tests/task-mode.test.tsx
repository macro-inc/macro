/**
 * @vitest-environment jsdom
 */

import { render as renderBare, screen, within } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    }),
  });
});

vi.mock('@core/util/upload', () => ({
  chatRuleset: {},
  uploadFile: vi.fn(),
}));

vi.mock('@core/cursor/flag', () => ({
  useCursorAgentsAccess: () => () => true,
}));

// Several service clients in StaticMarkdown's import graph build websocket
// connections at module scope, which jsdom cannot do. Stub the builder so
// every module-scope socket is inert.
vi.mock('@macro-inc/collaboration/websocket', async (importOriginal) => {
  const actual = await importOriginal<object>();
  const socket = {
    addEventListener: () => {},
    removeEventListener: () => {},
    send: () => {},
    close: () => {},
  };
  const builder: object = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === 'symbol' || prop === 'then') return undefined;
        return prop === 'build' ? () => socket : () => builder;
      },
    }
  );
  return {
    ...actual,
    WebsocketBuilder: function WebsocketBuilder() {
      return builder;
    },
  };
});

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type?: string | null) => type ?? 'unknown',
}));

vi.mock('@phosphor-icons/core/regular/paperclip.svg?component-solid', () => ({
  default: () => <span data-testid="paperclip-icon" />,
}));

vi.mock('@phosphor/text-aa.svg', () => ({
  default: () => <span data-testid="format-icon" />,
}));

vi.mock('@phosphor/trash.svg', () => ({
  default: () => <span data-testid="trash-icon" />,
}));

vi.mock('@phosphor/x.svg', () => ({
  default: () => <span data-testid="close-icon" />,
}));

vi.mock('@phosphor/arrow-up.svg', () => ({
  default: () => <span data-testid="send-icon" />,
}));

vi.mock(
  '@phosphor-icons/core/regular/paper-plane-right.svg?component-solid',
  () => ({
    default: () => <span data-testid="paper-plane-icon" />,
  })
);

vi.mock('@phosphor/spinner-gap.svg', () => ({
  default: () => <span data-testid="spinner-icon" />,
}));

vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => <span data-testid="entity-icon" />,
}));

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { placeholder?: string; initialValue?: string }) => (
    <div
      data-testid="markdown-shell"
      data-initial-value={props.initialValue ?? ''}
    >
      {props.placeholder}
    </div>
  ),
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const controls = {
        clear: vi.fn(),
        focus: vi.fn(),
      };
      const lexical = {
        focus: vi.fn(),
        dispatchCommand: vi.fn(),
        getElementByKey: vi.fn(),
        getRootElement: vi.fn(),
        update: vi.fn((callback: () => void) => callback()),
      };
      const handle = {
        controls,
        lexical,
        plugins: { use: vi.fn() },
        selection: undefined,
        _internal: {},
      };
      type BuilderMock = Record<
        | 'namespace'
        | 'withMentions'
        | 'withEmojis'
        | 'withActions'
        | 'withLinks'
        | 'withHistory'
        | 'withCode'
        | 'withFilePaste'
        | 'withRestoreFocus'
        | 'withSelectionData'
        | 'withFloatingFormatMenu'
        | 'use'
        | 'onChange'
        | 'onEnter',
        () => BuilderMock
      > & {
        buildHandle: () => typeof handle;
        controls: typeof controls;
        lexical: typeof lexical;
        selection: undefined;
      };
      const builder: BuilderMock = {
        namespace: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withActions: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withFilePaste: () => builder,
        withRestoreFocus: () => builder,
        withSelectionData: () => builder,
        withFloatingFormatMenu: () => builder,
        use: () => builder,
        onChange: () => builder,
        onEnter: () => builder,
        buildHandle: () => handle,
        controls,
        lexical,
        selection: undefined,
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  createDragInsertStore: () => [
    { nodeKey: null, position: null, visible: false },
    vi.fn(),
  ],
  DefaultShortcuts: {},
  INSERT_DOCUMENT_MENTION_COMMAND: 'INSERT_DOCUMENT_MENTION_COMMAND',
  NODE_TRANSFORM: 'NODE_TRANSFORM',
  keyboardShortcutsPlugin: () => () => () => {},
}));

vi.mock('@core/component/LexicalMarkdown/plugins/tables/tablePlugin', () => ({
  tablePlugin: () => () => () => {},
}));

vi.mock(
  '@core/component/LexicalMarkdown/plugins/tables/tableCellResizerPlugin',
  () => ({
    tableCellResizerPlugin: () => () => () => {},
  })
);

vi.mock('../FormatButtons', () => ({
  FormatButtons: () => <div data-testid="format-buttons" />,
}));

// The real composer drags in the compose-task dialog's editor and property
// stack; these tests only exercise the mode switch wiring around it.
vi.mock('../TaskComposer', () => ({
  TaskComposer: (props: {
    active: boolean;
    onSend: (task: {
      documentId: string;
      title: string;
      content: string;
    }) => void;
    modeSwitch?: JSX.Element;
  }) => (
    <div data-testid="task-composer">
      {props.modeSwitch}
      <button
        type="button"
        data-testid="task-composer-send"
        onClick={() =>
          props.onSend({ documentId: 'task-1', title: 'A task', content: '' })
        }
      >
        send task
      </button>
    </div>
  ),
}));

import { ChannelInput } from '../ChannelInput';
import { TaskModeChannelInput } from '../TaskModeChannelInput';
import type { InputData } from '../types';

vi.mock('@core/component/LexicalMarkdown/utils/create-has-line-breaks', () => ({
  createHasLineBreaks: () => () => false,
}));

const baseInput: InputData = {
  mode: 'channel',
  id: 'input-1',
  placeholder: 'Message channel',
  value: '',
  showFormatRibbon: false,
  hasPendingAttachments: false,
  attachments: [],
};

/**
 * `ChannelInput` reads the stored Cursor API key status to decide whether to
 * offer `@cursor` in the mention typeahead, so it needs a query client even
 * though none of these tests care about that entry. Shadowing `render` keeps
 * every call site below unchanged.
 */
const testQueryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

function render(ui: () => JSX.Element) {
  return renderBare(() => (
    <QueryClientProvider client={testQueryClient}>{ui()}</QueryClientProvider>
  ));
}

describe('Channel input task mode', () => {
  it('keeps the base channel input message-only', () => {
    render(() => <ChannelInput input={baseInput} />);

    expect(screen.queryByRole('switch', { name: 'Task' })).toBeNull();
    expect(screen.queryByTestId('task-composer')).toBeNull();
  });

  it('opens attachments directly without a task or formatting menu', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <TaskModeChannelInput input={baseInput} onSendTask={() => {}} />
    ));
    const click = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(click).toHaveBeenCalledOnce();
    click.mockRestore();
    expect(container.firstElementChild?.classList).toContain(
      'macro-message-width'
    );
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Format' })).toBeNull();
    expect(screen.queryByTestId('task-composer')).toBeNull();
  });

  it('lets an existing persisted task draft return to message mode', async () => {
    const user = userEvent.setup();
    const taskPersistence = {
      draftKey: 'task-composer-draft-channel:c1-persist-v0' as const,
      modeKey: 'input-task-mode-channel:c1-persist-v0' as const,
    };
    localStorage.setItem(taskPersistence.modeKey, 'true');
    const { container } = render(() => (
      <TaskModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        taskPersistence={taskPersistence}
      />
    ));
    const taskFace = container.querySelector('[data-input-face="task"]');
    expect(taskFace?.classList.contains('hidden')).toBe(false);
    await user.click(
      within(taskFace as HTMLElement).getByRole('button', {
        name: 'Back to message',
      })
    );
    expect(
      container
        .querySelector('[data-input-face="message"]')
        ?.classList.contains('hidden')
    ).toBe(false);
    expect(taskFace?.classList.contains('hidden')).toBe(true);
    expect(localStorage.getItem(taskPersistence.modeKey)).toBe('false');
    localStorage.removeItem(taskPersistence.modeKey);
  });

  it('forwards a restored task and returns to message mode on send', async () => {
    const user = userEvent.setup();
    const taskPersistence = {
      draftKey: 'task-composer-draft-channel:c1-send-persist-v0' as const,
      modeKey: 'input-task-mode-channel:c1-send-persist-v0' as const,
    };
    localStorage.setItem(taskPersistence.modeKey, 'true');
    const onSendTask = vi.fn();
    const { container } = render(() => (
      <TaskModeChannelInput
        input={baseInput}
        onSendTask={onSendTask}
        taskPersistence={taskPersistence}
      />
    ));
    await user.click(screen.getByTestId('task-composer-send'));
    expect(onSendTask).toHaveBeenCalledExactlyOnceWith({
      documentId: 'task-1',
      title: 'A task',
      content: '',
    });
    expect(
      container
        .querySelector('[data-input-face="message"]')
        ?.classList.contains('hidden')
    ).toBe(false);
    localStorage.removeItem(taskPersistence.modeKey);
  });
});
