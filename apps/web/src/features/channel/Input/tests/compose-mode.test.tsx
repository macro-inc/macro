/**
 * @vitest-environment jsdom
 */

import { render, screen, within } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';

const eventModeAvailable = vi.hoisted(() => ({ value: true }));

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

// The real composer drags in the calendar block's form and query stack;
// these tests only exercise the mode switch wiring around it.
vi.mock('../EventComposer', () => ({
  EventComposer: (props: {
    active: boolean;
    onSend: (event: { eventId: string; title: string }) => void;
    modeSwitch?: JSX.Element;
  }) => (
    <div data-testid="event-composer">
      {props.modeSwitch}
      <button
        type="button"
        data-testid="event-composer-send"
        onClick={() => props.onSend({ eventId: 'event-1', title: 'An event' })}
      >
        send event
      </button>
    </div>
  ),
}));

// The real availability check queries the calendar UI flag and the viewer's
// calendars; tests drive it through a mutable flag.
vi.mock('../event-mode-availability', () => ({
  createEventModeAvailability: () => () => eventModeAvailable.value,
}));

import { ChannelInput } from '../ChannelInput';
import { ComposeModeChannelInput } from '../ComposeModeChannelInput';
import type { InputData } from '../types';
import { makeComposePersistence } from '../utils/persistence';

const baseInput: InputData = {
  mode: 'channel',
  id: 'input-1',
  placeholder: 'Message channel',
  value: '',
  showFormatRibbon: false,
  hasPendingAttachments: false,
  attachments: [],
};

const eventMode = (onSendEvent: (event: unknown) => void = () => {}) => ({
  channelId: 'channel-1',
  onSendEvent,
});

describe('Channel input compose modes', () => {
  it('keeps the base channel input message-only', () => {
    render(() => <ChannelInput input={baseInput} />);

    expect(screen.queryByRole('radio', { name: 'Task' })).toBeNull();
    expect(screen.queryByTestId('task-composer')).toBeNull();
    expect(screen.queryByTestId('event-composer')).toBeNull();
  });

  it('shows the mode picker with Message selected at the normal input width', () => {
    const { container } = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        eventMode={eventMode()}
      />
    ));

    expect(container.firstElementChild?.classList).toContain(
      'macro-message-width'
    );
    expect(screen.getByRole('radio', { name: 'Message' })).toHaveProperty(
      'checked',
      true
    );
    expect(screen.getByRole('radio', { name: 'Task' })).toHaveProperty(
      'checked',
      false
    );
    expect(screen.getByRole('radio', { name: 'Event' })).toHaveProperty(
      'checked',
      false
    );
    expect(screen.queryByTestId('task-composer')).toBeNull();
    expect(screen.queryByTestId('event-composer')).toBeNull();
  });

  it('hides the event segment without an event mode config', () => {
    render(() => (
      <ComposeModeChannelInput input={baseInput} onSendTask={() => {}} />
    ));

    expect(screen.getByRole('radio', { name: 'Task' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Event' })).toBeNull();
  });

  it('hides the event segment while the calendar UI is unavailable', () => {
    eventModeAvailable.value = false;
    try {
      render(() => (
        <ComposeModeChannelInput
          input={baseInput}
          onSendTask={() => {}}
          eventMode={eventMode()}
        />
      ));

      expect(screen.getByRole('radio', { name: 'Task' })).toBeTruthy();
      expect(screen.queryByRole('radio', { name: 'Event' })).toBeNull();
    } finally {
      eventModeAvailable.value = true;
    }
  });

  it('swaps the input faces when picking task mode and back', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <ComposeModeChannelInput input={baseInput} onSendTask={() => {}} />
    ));

    await user.click(screen.getByRole('radio', { name: 'Task' }));

    expect(screen.getByTestId('task-composer')).toBeTruthy();
    const messageFace = container.querySelector('[data-input-face="message"]');
    const taskFace = container.querySelector('[data-input-face="task"]');
    expect(messageFace?.classList.contains('hidden')).toBe(true);
    expect(taskFace?.classList.contains('hidden')).toBe(false);

    // The picker rendered inside the composer footer has Task selected;
    // picking Message returns to message mode but keeps the composer
    // mounted for its draft.
    const composerFace = within(taskFace as HTMLElement);
    expect(composerFace.getByRole('radio', { name: 'Task' })).toHaveProperty(
      'checked',
      true
    );
    await user.click(composerFace.getByRole('radio', { name: 'Message' }));

    expect(messageFace?.classList.contains('hidden')).toBe(false);
    expect(taskFace?.classList.contains('hidden')).toBe(true);
    expect(screen.getByTestId('task-composer')).toBeTruthy();
  });

  it('swaps the input faces when picking event mode and back', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        eventMode={eventMode()}
      />
    ));

    await user.click(screen.getByRole('radio', { name: 'Event' }));

    expect(screen.getByTestId('event-composer')).toBeTruthy();
    const messageFace = container.querySelector('[data-input-face="message"]');
    const eventFace = container.querySelector('[data-input-face="event"]');
    expect(messageFace?.classList.contains('hidden')).toBe(true);
    expect(eventFace?.classList.contains('hidden')).toBe(false);

    const composerFace = within(eventFace as HTMLElement);
    expect(composerFace.getByRole('radio', { name: 'Event' })).toHaveProperty(
      'checked',
      true
    );
    await user.click(composerFace.getByRole('radio', { name: 'Message' }));

    expect(messageFace?.classList.contains('hidden')).toBe(false);
    expect(eventFace?.classList.contains('hidden')).toBe(true);
    expect(screen.getByTestId('event-composer')).toBeTruthy();
  });

  it('switches straight between the task and event faces', async () => {
    const user = userEvent.setup();
    const { container } = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        eventMode={eventMode()}
      />
    ));

    await user.click(screen.getByRole('radio', { name: 'Task' }));
    const taskFace = container.querySelector('[data-input-face="task"]');
    await user.click(
      within(taskFace as HTMLElement).getByRole('radio', { name: 'Event' })
    );

    const eventFace = container.querySelector('[data-input-face="event"]');
    expect(taskFace?.classList.contains('hidden')).toBe(true);
    expect(eventFace?.classList.contains('hidden')).toBe(false);
    expect(
      container
        .querySelector('[data-input-face="message"]')
        ?.classList.contains('hidden')
    ).toBe(true);
  });

  it('enters task mode from clicks on the segment label, not just the radio', async () => {
    const user = userEvent.setup();
    render(() => (
      <ComposeModeChannelInput input={baseInput} onSendTask={() => {}} />
    ));

    // The visible segment text is the Kobalte item label; clicking it must
    // select the mode just like clicking the radio input itself.
    await user.click(screen.getByText('Task'));

    expect(screen.getByTestId('task-composer')).toBeTruthy();
  });

  it('restores a persisted task mode on remount', async () => {
    const user = userEvent.setup();
    const composePersistence = makeComposePersistence({ channelId: 'c1' });
    localStorage.removeItem(composePersistence.modeKey);

    const first = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        composePersistence={composePersistence}
      />
    ));
    await user.click(screen.getByRole('radio', { name: 'Task' }));
    expect(
      first.container
        .querySelector('[data-input-face="task"]')
        ?.classList.contains('hidden')
    ).toBe(false);
    first.unmount();

    const second = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        composePersistence={composePersistence}
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
    localStorage.removeItem(composePersistence.modeKey);
  });

  it('migrates the legacy boolean task-mode key into the compose-mode key', () => {
    const legacyKey = 'input-task-mode-channel:c2-persist-v0';
    localStorage.setItem(legacyKey, 'true');

    const composePersistence = makeComposePersistence({ channelId: 'c2' });

    expect(localStorage.getItem(legacyKey)).toBeNull();
    expect(localStorage.getItem(composePersistence.modeKey)).toBe('"task"');

    const { container } = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        composePersistence={composePersistence}
      />
    ));
    expect(
      container
        .querySelector('[data-input-face="task"]')
        ?.classList.contains('hidden')
    ).toBe(false);
    localStorage.removeItem(composePersistence.modeKey);
  });

  it('forwards the created task and returns to message mode on send', async () => {
    const user = userEvent.setup();
    const onSendTask = vi.fn();
    const { container } = render(() => (
      <ComposeModeChannelInput input={baseInput} onSendTask={onSendTask} />
    ));

    await user.click(screen.getByRole('radio', { name: 'Task' }));
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

  it('forwards the created event and returns to message mode on send', async () => {
    const user = userEvent.setup();
    const onSendEvent = vi.fn();
    const { container } = render(() => (
      <ComposeModeChannelInput
        input={baseInput}
        onSendTask={() => {}}
        eventMode={eventMode(onSendEvent)}
      />
    ));

    await user.click(screen.getByRole('radio', { name: 'Event' }));
    await user.click(screen.getByTestId('event-composer-send'));

    expect(onSendEvent).toHaveBeenCalledOnce();
    expect(onSendEvent.mock.calls[0]?.[0]).toEqual({
      eventId: 'event-1',
      title: 'An event',
    });
    const messageFace = container.querySelector('[data-input-face="message"]');
    expect(messageFace?.classList.contains('hidden')).toBe(false);
  });
});
