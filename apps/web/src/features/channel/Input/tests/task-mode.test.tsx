/**
 * @vitest-environment jsdom
 */

import { render, screen, within } from '@solidjs/testing-library';
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
import type { InputData } from '../types';

const baseInput: InputData = {
  mode: 'channel',
  id: 'input-1',
  placeholder: 'Message channel',
  value: '',
  showFormatRibbon: false,
  hasPendingAttachments: false,
  attachments: [],
};

describe('Channel input task mode', () => {
  it('omits the task mode switch when onSendTask is not provided', () => {
    render(() => <ChannelInput input={baseInput} />);

    expect(screen.queryByRole('switch', { name: 'Task' })).toBeNull();
    expect(screen.queryByTestId('task-composer')).toBeNull();
  });

  it('shows an unchecked task mode switch when onSendTask is provided', () => {
    render(() => <ChannelInput input={baseInput} onSendTask={() => {}} />);

    const modeSwitch = screen.getByRole('switch', { name: 'Task' });
    expect(modeSwitch).toHaveProperty('checked', false);
    expect(screen.queryByTestId('task-composer')).toBeNull();
  });

  it('swaps the input faces when toggling task mode on and off', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <ChannelInput input={baseInput} onSendTask={() => {}} />
    ));

    await user.click(screen.getByRole('switch', { name: 'Task' }));

    expect(screen.getByTestId('task-composer')).toBeTruthy();
    const messageFace = container.querySelector('[data-input-face="message"]');
    const taskFace = container.querySelector('[data-input-face="task"]');
    expect(messageFace?.classList.contains('hidden')).toBe(true);
    expect(taskFace?.classList.contains('hidden')).toBe(false);

    // The switch rendered inside the composer footer is checked; toggling it
    // returns to message mode but keeps the composer mounted for its draft.
    const composerSwitch = within(taskFace as HTMLElement).getByRole('switch', {
      name: 'Task',
    });
    expect(composerSwitch).toHaveProperty('checked', true);
    await user.click(composerSwitch);

    expect(messageFace?.classList.contains('hidden')).toBe(false);
    expect(taskFace?.classList.contains('hidden')).toBe(true);
    expect(screen.getByTestId('task-composer')).toBeTruthy();
  });

  it('enters task mode from clicks on the switch pill itself, not just the control', async () => {
    const user = userEvent.setup();
    render(() => <ChannelInput input={baseInput} onSendTask={() => {}} />);

    // The pill (Kobalte switch root) is the label's parent; clicking its
    // padding must toggle just like clicking the control or label.
    const pill = screen.getByText('Task').parentElement as HTMLElement;
    await user.click(pill);

    expect(screen.getByTestId('task-composer')).toBeTruthy();
  });

  it('restores a persisted task mode on remount', async () => {
    const user = userEvent.setup();
    const taskPersistence = {
      draftKey: 'task-composer-draft-channel:c1-persist-v0' as const,
      modeKey: 'input-task-mode-channel:c1-persist-v0' as const,
    };
    localStorage.removeItem(taskPersistence.modeKey);

    const first = render(() => (
      <ChannelInput
        input={baseInput}
        onSendTask={() => {}}
        taskPersistence={taskPersistence}
      />
    ));
    await user.click(screen.getByRole('switch', { name: 'Task' }));
    expect(
      first.container
        .querySelector('[data-input-face="task"]')
        ?.classList.contains('hidden')
    ).toBe(false);
    first.unmount();

    const second = render(() => (
      <ChannelInput
        input={baseInput}
        onSendTask={() => {}}
        taskPersistence={taskPersistence}
      />
    ));
    const taskFace = second.container.querySelector('[data-input-face="task"]');
    expect(taskFace).toBeTruthy();
    expect(taskFace?.classList.contains('hidden')).toBe(false);
    expect(
      second.container
        .querySelector('[data-input-face="message"]')
        ?.classList.contains('hidden')
    ).toBe(true);
    localStorage.removeItem(taskPersistence.modeKey);
  });

  it('forwards the created task and returns to message mode on send', async () => {
    const user = userEvent.setup();
    const onSendTask = vi.fn();
    const { container } = render(() => (
      <ChannelInput input={baseInput} onSendTask={onSendTask} />
    ));

    await user.click(screen.getByRole('switch', { name: 'Task' }));
    await user.click(screen.getByTestId('task-composer-send'));

    expect(onSendTask).toHaveBeenCalledOnce();
    expect(onSendTask.mock.calls[0]?.[0]).toEqual({
      documentId: 'task-1',
      title: 'A task',
      content: '',
    });
    const messageFace = container.querySelector('[data-input-face="message"]');
    expect(messageFace?.classList.contains('hidden')).toBe(false);
  });
});
