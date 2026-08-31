/**
 * @vitest-environment jsdom
 */

import { render as renderBare, screen } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import userEvent from '@testing-library/user-event';
import type { JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const editorMocks = vi.hoisted(() => ({
  clear: vi.fn(),
  focus: vi.fn(),
}));

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

vi.mock('@core/component/ImagePreview', () => ({
  ImagePreview: (props: { image: { id: string } }) => (
    <div data-testid={`image-preview-${props.image.id}`} />
  ),
}));

vi.mock('@core/component/VideoPreview', () => ({
  VideoPreview: (props: { id: string }) => (
    <div data-testid={`video-preview-${props.id}`} />
  ),
}));

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { placeholder?: string; initialValue?: string }) => (
    <>
      <div
        data-testid="markdown-shell"
        data-initial-value={props.initialValue ?? ''}
      >
        {props.placeholder}
      </div>
      <Portal>
        <input data-testid="markdown-portal-input" />
      </Portal>
    </>
  ),
}));

vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const controls = {
        clear: editorMocks.clear,
        focus: editorMocks.focus,
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
      const builder: any = {
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

import { createInputAttachmentTracker } from '../attachment-tracker';
import { ChannelInput } from '../ChannelInput';
import { DropOverlay } from '../DropOverlay';
import { Root } from '../Root';
import type { InputData, InputHandle } from '../types';

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

describe('Input slots', () => {
  beforeEach(() => {
    editorMocks.clear.mockClear();
    editorMocks.focus.mockClear();
  });

  it('does not refocus the editor when a portaled editor control is clicked', async () => {
    const user = userEvent.setup();
    render(() => <ChannelInput input={baseInput} />);

    await user.click(screen.getByTestId('markdown-shell'));
    expect(editorMocks.focus).toHaveBeenCalledOnce();

    editorMocks.focus.mockClear();
    await user.click(screen.getByTestId('markdown-portal-input'));

    expect(editorMocks.focus).not.toHaveBeenCalled();
  });

  it('renders the default action composition and wires handlers through context', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onToggleFormatRibbon = vi.fn();
    const onClose = vi.fn();

    const { container } = render(() =>
      (() => {
        return (
          <ChannelInput
            input={{ ...baseInput, mode: 'reply', value: 'reply' }}
            onSend={onSend}
            onToggleFormatRibbon={onToggleFormatRibbon}
            onClose={onClose}
          />
        );
      })()
    );

    expect(container.querySelector('[data-input-actions]')).toBeTruthy();
    expect(container.querySelector('[data-input-actions-left]')).toBeTruthy();
    expect(container.querySelector('[data-input-actions-right]')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click');
    await user.click(screen.getByRole('button', { name: 'Attach files' }));
    await user.click(screen.getByRole('button', { name: 'Format' }));
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    clickSpy.mockRestore();
    expect(onToggleFormatRibbon).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('reply');
  });

  it('omits the reply action for channel mode', () => {
    render(() => <ChannelInput input={baseInput} />);

    expect(screen.queryByRole('button', { name: 'Delete reply' })).toBeNull();
  });

  it('renders custom action composition from children instead of defaults', () => {
    render(() => (
      <ChannelInput input={baseInput}>
        <div data-testid="custom-actions">custom actions</div>
      </ChannelInput>
    ));

    expect(screen.getByTestId('custom-actions')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Attach files' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send message' })).toBeNull();
  });

  it('disables send while attachments are pending', () => {
    render(() =>
      (() => {
        const attachmentTracker = createInputAttachmentTracker({
          initialAttachments: [
            {
              id: 'pending-1',
              name: 'uploading.png',
              kind: 'image',
              pending: true,
            },
          ],
        });

        return (
          <ChannelInput
            input={baseInput}
            attachmentTracker={attachmentTracker}
          />
        );
      })()
    );

    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('disables send when the input is empty', () => {
    render(() => <ChannelInput input={{ ...baseInput, value: '   ' }} />);

    expect(screen.getByRole('button', { name: 'Send message' })).toHaveProperty(
      'disabled',
      true
    );
  });

  it('exposes send through the input handle', async () => {
    const onSend = vi.fn();
    let handle: InputHandle | undefined;

    render(() => (
      <ChannelInput
        input={{ ...baseInput, value: 'handle send' }}
        onReady={(nextHandle) => {
          handle = nextHandle;
        }}
        onSend={onSend}
      />
    ));

    await handle?.send();

    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('handle send');
  });

  it('shows the drop overlay when dragged over', () => {
    render(() => (
      <Root input={{ ...baseInput, isDraggedOver: true }}>
        <DropOverlay hint="Drop files to attach" />
      </Root>
    ));

    expect(screen.getByText('Drop files to attach')).toBeTruthy();
  });
});
