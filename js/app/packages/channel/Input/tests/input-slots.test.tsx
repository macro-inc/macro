/**
 * @vitest-environment jsdom
 */

import userEvent from '@testing-library/user-event';
import { render, screen } from '@solidjs/testing-library';
import { beforeAll, describe, expect, it, vi } from 'vitest';

beforeAll(() => {
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

vi.mock('@core/constant/allBlocks', () => ({
  fileTypeToBlockName: (type?: string | null) => type ?? 'unknown',
}));

vi.mock('@phosphor-icons/core/regular/paperclip.svg?component-solid', () => ({
  default: () => <span data-testid="paperclip-icon" />,
}));

vi.mock('@icon/regular/text-aa.svg', () => ({
  default: () => <span data-testid="format-icon" />,
}));

vi.mock('@icon/regular/trash.svg', () => ({
  default: () => <span data-testid="trash-icon" />,
}));

vi.mock('@icon/regular/x.svg', () => ({
  default: () => <span data-testid="close-icon" />,
}));

vi.mock('@icon/bold/arrow-up-bold.svg', () => ({
  default: () => <span data-testid="send-icon" />,
}));

vi.mock('@icon/bold/spinner-gap-bold.svg', () => ({
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
      const builder: any = {
        namespace: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        withRestoreFocus: () => builder,
        withSelectionData: () => builder,
        use: () => builder,
        onChange: () => builder,
        onEnter: () => builder,
        controls: {
          clear: vi.fn(),
          focus: vi.fn(),
        },
        lexical: {
          focus: vi.fn(),
          dispatchCommand: vi.fn(),
        },
        selection: undefined,
      };
      return builder;
    },
  })
);

vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  DefaultShortcuts: {},
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

import { ChannelInput } from '../ChannelInput';
import { Root } from '../Root';
import { DropOverlay } from '../DropOverlay';
import { createInputAttachmentTracker } from '../attachment-tracker';
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

describe('Input slots', () => {
  it('renders the default action composition and wires handlers through context', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onToggleFormatRibbon = vi.fn();
    const onClose = vi.fn();

    const { container } = render(() =>
      (() => {
        return (
          <ChannelInput
            input={{ ...baseInput, mode: 'reply' }}
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
    expect(onSend.mock.calls[0]?.[0]?.value).toBe('');
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

  it('shows invalid state in drop overlay', () => {
    render(() => (
      <Root
        input={{
          ...baseInput,
          isDraggedOver: true,
          isValidChannelDrag: false,
        }}
      >
        <DropOverlay invalidMessage="[!] Invalid attachment file" />
      </Root>
    ));

    expect(screen.getByText('[!] Invalid attachment file')).toBeTruthy();
  });
});
