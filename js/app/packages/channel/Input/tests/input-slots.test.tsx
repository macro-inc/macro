/**
 * @vitest-environment jsdom
 */

import userEvent from '@testing-library/user-event';
import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { placeholder?: string }) => (
    <div data-testid="markdown-shell">{props.placeholder}</div>
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

import { ChannelInput } from '../ChannelInput';
import { createChannelInputController } from '../createChannelInputController';
import { createInputAttachmentTracker } from '../attachment-tracker';
import { Root } from '../Root';
import { DropOverlay } from '../DropOverlay';
import type { InputData } from '../types';

const baseInput: InputData = {
  id: 'input-1',
  placeholder: 'Message channel',
  value: '',
  showFormatRibbon: false,
  showAttachMenu: false,
  taskModeEnabled: false,
  hasPendingAttachments: false,
  attachments: [],
  tasks: [],
};

describe('Input slots', () => {
  it('composes a basic channel input using external controller state', async () => {
    const user = userEvent.setup();

    render(() => (
      (() => {
        const attachmentTracker = createInputAttachmentTracker();
        const controller = createChannelInputController({
          inputId: 'test-channel-input',
          placeholder: 'Message general',
          initialValue: 'first task\nsecond task',
          attachmentTracker,
        });

        return (
          <ChannelInput
            input={controller.input()}
            actions={controller.actions}
            attachmentTracker={attachmentTracker}
          />
        );
      })()
    ));

    expect(screen.getByText('Message general')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Task mode' }));

    expect(screen.getByText('first task')).toBeTruthy();
    expect(screen.getByText('second task')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(screen.getByRole('button', { name: 'Add image' }));
    expect(screen.getByText('image.png')).toBeTruthy();
  });

  it('wires send and primary action handlers through context', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    const onToggleAttachMenu = vi.fn();
    const onToggleFormatRibbon = vi.fn();
    const onToggleTaskMode = vi.fn();
    const onCloseDraft = vi.fn();

    render(() => (
      (() => {
        const attachmentTracker = createInputAttachmentTracker();
        return (
          <ChannelInput
            input={{ ...baseInput, isReplyInput: true, showAttachMenu: false }}
            attachmentTracker={attachmentTracker}
            actions={{
              onSend,
              onToggleAttachMenu,
              onToggleFormatRibbon,
              onToggleTaskMode,
              onCloseDraft,
            }}
          />
        );
      })()
    ));

    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(screen.getByRole('button', { name: 'Attach' }));
    await user.click(screen.getByRole('button', { name: 'Format' }));
    await user.click(screen.getByRole('button', { name: 'Task mode' }));
    await user.click(screen.getByRole('button', { name: 'Delete reply' }));

    expect(onSend).toHaveBeenCalledOnce();
    expect(onToggleAttachMenu).toHaveBeenCalledOnce();
    expect(onToggleFormatRibbon).toHaveBeenCalledOnce();
    expect(onToggleTaskMode).toHaveBeenCalledOnce();
    expect(onCloseDraft).toHaveBeenCalledOnce();
    expect(onSend.mock.calls[0]?.[0]?.input.id).toBe('input-1');
  });

  it('renders placeholder, attachments, and task preview from input state', () => {
    render(() => (
      (() => {
        const attachmentTracker = createInputAttachmentTracker({
          initialAttachments: [
            { id: 'a1', kind: 'video', name: 'clip.mov' },
            { id: 'a2', kind: 'image', name: 'image.png' },
            { id: 'a3', kind: 'document', name: 'spec.md' },
          ],
        });

        return (
          <ChannelInput
            input={{
              ...baseInput,
              showFormatRibbon: true,
              taskModeEnabled: true,
              tasks: [
                { id: 't1', title: 'Task one' },
                { id: 't2', title: 'Task two' },
              ],
            }}
            actions={{}}
            attachmentTracker={attachmentTracker}
          />
        );
      })()
    ));

    expect(screen.getByText('Message channel')).toBeTruthy();
    expect(screen.getByText('clip.mov')).toBeTruthy();
    expect(screen.getByText('image.png')).toBeTruthy();
    expect(screen.getByText('spec.md')).toBeTruthy();
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByText('Task two')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Task mode' })).toBeTruthy();
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
