import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueuedPrompts } from './QueuedPrompts';

const editor = vi.hoisted(() => ({
  change: undefined as ((markdown: string) => void) | undefined,
  enter: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  escape: undefined as ((event: KeyboardEvent) => boolean) | undefined,
  markdown: 'Queued request',
  focus: vi.fn(),
  // Like the real editor outside a Lexical update and outside a Solid
  // effect: the set applies at once and reports the change before returning.
  setMarkdown: vi.fn((markdown: string) => {
    editor.markdown = markdown;
    editor.change?.(markdown);
  }),
}));
const touch = vi.hoisted(() => ({ value: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.value,
}));
vi.mock(
  '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder',
  () => ({
    buildConfig: () => {
      const builder = {
        namespace: () => builder,
        withAppLinkResolver: () => builder,
        withMentions: () => builder,
        withEmojis: () => builder,
        withLinks: () => builder,
        withHistory: () => builder,
        withCode: () => builder,
        onChange: (callback: (markdown: string) => void) => {
          editor.change = callback;
          return builder;
        },
        onFocusLeave: () => builder,
        onEnter: (callback: (event: KeyboardEvent) => boolean) => {
          editor.enter = callback;
          return builder;
        },
        onEscape: () => builder,
        use: (
          plugin: (lexical: {
            registerCommand: (
              command: unknown,
              callback: (event: KeyboardEvent) => boolean,
              priority: number
            ) => () => void;
          }) => () => void
        ) => {
          plugin({
            registerCommand: (_command, callback) => {
              editor.escape = callback;
              return () => {};
            },
          });
          return builder;
        },
        lexical: { getRootElement: () => null },
        controls: {
          focus: editor.focus,
          getMarkdown: () => editor.markdown,
          setMarkdown: editor.setMarkdown,
        },
      };
      return builder;
    },
  })
);
vi.mock('@core/component/LexicalMarkdown/builder/MarkdownShell', () => ({
  MarkdownShell: (props: { initialValue?: string; disabled?: boolean }) => (
    <div role="textbox" aria-readonly={props.disabled} tabindex="0">
      {props.initialValue}
    </div>
  ),
}));
// The real static surface has its own markdown rendering suite; here the
// preview only needs to show which markdown it was handed.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: (props: {
      markdown: string;
      singleLine?: boolean;
      inert?: boolean;
    }) => (
      <span
        data-testid="static-markdown"
        data-single-line={props.singleLine}
        data-inert={props.inert}
      >
        {props.markdown}
      </span>
    ),
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({
  singleLineMarkdownTheme: {},
}));
vi.mock('@components/app/split-layout/split-router/mention-links', () => ({
  useMacroMentionLinkResolver: () => undefined,
}));
vi.mock('@ui', () => ({
  Surface: (props: { children?: JSX.Element }) => props.children,
  Tooltip: (props: { children?: JSX.Element }) => props.children,
  Button: (props: {
    'aria-label'?: string;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onClick={props.onClick}
    />
  ),
}));

/** The composer stand-in that `onNavigateBelow` focuses. */
function renderComposer() {
  const composer = document.createElement('input');
  composer.type = 'button';
  composer.setAttribute('aria-label', 'Composer');
  document.body.appendChild(composer);
  return composer;
}

beforeEach(() => {
  editor.markdown = 'Queued request';
  editor.focus.mockClear();
  editor.setMarkdown.mockClear();
  touch.value = false;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('queued prompt preview', () => {
  it('renders prompt markdown through the single-line static surface', () => {
    const link =
      '<m-link>{"url":"https://example.com","text":"example"}</m-link>';
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'linked', kind: 'prompt', prompt: `Read ${link}` },
          { actionId: 'files', kind: 'prompt', prompt: '' },
          { actionId: 'compact', kind: 'compact' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    const previews = screen.getAllByTestId('static-markdown');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.textContent).toBe(`Read ${link}`);
    expect(previews[0]?.getAttribute('data-single-line')).toBe('true');
    expect(previews[0]?.getAttribute('data-inert')).toBe('true');
    expect(screen.getByRole('button', { name: 'Attached files' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Compact the conversation' })
    ).toBeTruthy();
  });

  it('shows the text once: the editor replaces the preview while open', () => {
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    const preview = screen.getByRole('button', { name: 'Queued request' });
    expect(screen.queryByRole('textbox')).toBeNull();

    fireEvent.click(preview);
    expect(preview.hidden).toBe(true);
    expect(screen.queryByRole('button', { name: 'Queued request' })).toBeNull();
    expect(screen.getByRole('textbox').textContent).toBe('Queued request');
    // Every visible rendering of the prompt, however it is produced.
    const visibleCopies = Array.from(
      document.body.querySelectorAll('*')
    ).filter(
      (element) =>
        element.children.length === 0 &&
        element.textContent === 'Queued request' &&
        element.closest('[hidden]') === null
    );
    expect(visibleCopies).toHaveLength(1);

    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(
      editor.escape?.(new KeyboardEvent('keydown', { key: 'Escape' }))
    ).toBe(true);
    expect(preview.hidden).toBe(false);
    expect(screen.queryByRole('textbox')).toBeNull();
    // Escape restored the saved text, so the preview still shows it.
    expect(screen.getByTestId('static-markdown').textContent).toBe(
      'Queued request'
    );
  });
});

describe('queued prompt keys', () => {
  it('opens the next-to-send row from Up in the composer', () => {
    let focusFromBelow: (() => void) | undefined;
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Next to send' },
          { actionId: 'second', kind: 'prompt', prompt: 'Newest request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        registerFocusFromBelow={(focus) => (focusFromBelow = focus)}
      />
    ));
    focusFromBelow?.();
    expect(screen.getByRole('textbox').textContent).toBe('Next to send');
    expect(editor.focus).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('saves on Enter, closes, and returns focus to the composer', () => {
    const composer = renderComposer();
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onNavigateBelow={() => composer.focus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(onEdit).not.toHaveBeenCalled();

    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      true
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('first', 'Updated request');
    expect(document.activeElement).toBe(composer);
    expect(screen.queryByRole('textbox')).toBeNull();
    const updated = screen.getByRole('button', { name: 'Updated request' });
    expect(updated.hidden).toBe(false);
  });

  it('restores the saved text on Escape and returns focus to the composer', () => {
    const composer = renderComposer();
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onNavigateBelow={() => composer.focus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'Abandoned edit';
    editor.change?.(editor.markdown);

    expect(
      editor.escape?.(new KeyboardEvent('keydown', { key: 'Escape' }))
    ).toBe(true);
    expect(editor.setMarkdown).toHaveBeenCalledExactlyOnceWith(
      'Queued request'
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(composer);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Queued request' })).toBeTruthy();
  });

  it('ignores the Enter that confirms an IME composition', () => {
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'Queued request 日本';
    editor.change?.(editor.markdown);
    const composing = new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
    });
    expect(editor.enter?.(composing)).toBe(false);
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('applies a server snapshot to an untouched row and sends the next edit', () => {
    const [prompt, setPrompt] = createSignal('Queued request');
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[{ actionId: 'first', kind: 'prompt', prompt: prompt() }]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    // Another user's edit lands while the row is closed.
    setPrompt('Queued request, revised');
    expect(editor.setMarkdown).toHaveBeenCalledExactlyOnceWith(
      'Queued request, revised'
    );
    const revised = screen.getByRole('button', {
      name: 'Queued request, revised',
    });
    fireEvent.click(revised);
    editor.markdown = 'Queued request, revised again';
    editor.change?.(editor.markdown);
    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      true
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith(
      'first',
      'Queued request, revised again'
    );
  });

  it('keeps a just-saved edit when the list changes before the server echoes it', () => {
    const [items, setItems] = createSignal([
      { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
    ]);
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts items={items()} onEdit={onEdit} onRemove={vi.fn()} />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      true
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('first', 'Updated request');
    // A new list snapshot with the same, not yet echoed, prompt.
    setItems([
      { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
      { actionId: 'second', kind: 'prompt', prompt: 'Another request' },
    ]);
    expect(editor.setMarkdown).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Updated request' })
    ).toBeTruthy();
  });

  it('still sends an edit typed after an in-row restore', () => {
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onSteer={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    // Emptied, then focus moves within the row: the text is restored and
    // the row stays open.
    editor.markdown = '';
    editor.change?.(editor.markdown);
    fireEvent.focusOut(textbox, {
      relatedTarget: screen.getByRole('button', { name: 'Steer' }),
    });
    expect(editor.setMarkdown).toHaveBeenCalledExactlyOnceWith(
      'Queued request'
    );
    expect(screen.getByRole('textbox')).toBe(textbox);
    // One change after the restore is a real edit.
    editor.markdown = 'New request';
    editor.change?.(editor.markdown);
    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      true
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('first', 'New request');
  });

  it('lets Enter stay a newline on touch and saves when focus leaves', () => {
    touch.value = true;
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      false
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toBeTruthy();

    fireEvent.focusOut(screen.getByRole('textbox'));
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('first', 'Updated request');
  });

  it('closes when focus lands outside the row and stays open within it', () => {
    const composer = renderComposer();
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
        onSteer={vi.fn()}
        onNavigateBelow={() => composer.focus()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);

    fireEvent.focusOut(textbox, {
      relatedTarget: screen.getByRole('button', { name: 'Steer' }),
    });
    expect(screen.getByRole('textbox')).toBe(textbox);
    // The editor's floating link menu lives outside the row but belongs to
    // the edit.
    const menu = document.createElement('div');
    menu.className = 'menu-surface';
    const editLink = document.createElement('button');
    menu.appendChild(editLink);
    document.body.appendChild(menu);
    fireEvent.focusOut(textbox, { relatedTarget: editLink });
    expect(screen.getByRole('textbox')).toBe(textbox);

    fireEvent.focusOut(textbox, { relatedTarget: composer });
    expect(onEdit).toHaveBeenCalledExactlyOnceWith('first', 'Updated request');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Updated request' })
    ).toBeTruthy();
  });

  it('falls back to the preview when there is no composer to return to', () => {
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    const preview = screen.getByRole('button', { name: 'Queued request' });
    fireEvent.click(preview);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(preview);
  });
});

describe('queued prompt access', () => {
  it('opens only the selected editor among several rows', () => {
    render(() => (
      <QueuedPrompts
        items={[
          {
            actionId: 'first',
            kind: 'prompt',
            prompt: 'First request\nMore detail',
          },
          { actionId: 'second', kind: 'prompt', prompt: 'Second request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.queryByRole('textbox')).toBeNull();
    const first = screen.getByRole('button', {
      name: /First request\s+More detail/,
    });
    const second = screen.getByRole('button', { name: 'Second request' });
    fireEvent.click(first);
    expect(first.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(editor.focus).toHaveBeenCalledOnce();

    fireEvent.click(second);
    expect(first.getAttribute('aria-expanded')).toBe('false');
    expect(first.hidden).toBe(false);
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByRole('textbox').textContent).toBe('Second request');
  });

  it('keeps the editor mounted across close and reopen', () => {
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    editor.markdown = 'Updated request';
    editor.change?.(editor.markdown);
    expect(editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }))).toBe(
      true
    );
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Updated request' }));
    expect(screen.getByRole('textbox')).toBe(textbox);
  });

  it('shows queued text without permitting edits or removal for viewers', () => {
    const onEdit = vi.fn();
    const onRemove = vi.fn();
    render(() => (
      <QueuedPrompts
        disabled
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={onRemove}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const textbox = screen.getByRole('textbox');
    expect(textbox.textContent).toBe('Queued request');
    expect(textbox.getAttribute('aria-readonly')).toBe('true');
    // The read-only editor cannot take focus; the row still holds it so
    // Escape closes.
    expect(document.activeElement?.contains(textbox)).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    const remove = screen.getByRole('button', {
      name: 'Remove queued message',
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    fireEvent.click(remove);
    editor.markdown = 'Attempted edit';
    editor.change?.(editor.markdown);
    editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }));
    fireEvent.focusOut(textbox);

    expect(onEdit).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('brings the saved text back instead of saving an emptied row', () => {
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Queued request' }));
    editor.markdown = '   ';
    editor.change?.(editor.markdown);
    editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onEdit).not.toHaveBeenCalled();
    expect(editor.setMarkdown).toHaveBeenCalledExactlyOnceWith(
      'Queued request'
    );
    expect(screen.getByRole('button', { name: 'Queued request' })).toBeTruthy();
  });

  it('does not send an edit for text that only re-serialized', () => {
    const onEdit = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[{ actionId: 'queued-1', kind: 'prompt', prompt: 'See [a](b)' }]}
        onEdit={onEdit}
        onRemove={vi.fn()}
      />
    ));
    // The editor writes the same link out with extra markup.
    editor.markdown = 'See [a](b "")';
    fireEvent.click(screen.getByRole('button', { name: 'See [a](b)' }));
    editor.enter?.(new KeyboardEvent('keydown', { key: 'Enter' }));
    fireEvent.click(screen.getByRole('button', { name: 'See [a](b)' }));
    editor.escape?.(new KeyboardEvent('keydown', { key: 'Escape' }));
    fireEvent.click(screen.getByRole('button', { name: 'See [a](b)' }));
    fireEvent.focusOut(screen.getByRole('textbox'));
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('steers the selected queued message without opening its editor', () => {
    const onSteer = vi.fn();
    render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'first', kind: 'prompt', prompt: 'Next to send' },
          { actionId: 'second', kind: 'prompt', prompt: 'Steer this' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onSteer={onSteer}
      />
    ));

    const steer = screen.getAllByRole('button', { name: 'Steer' });
    expect(steer).toHaveLength(2);
    // Newest is rendered first; "Steer this" is the second queued entry.
    fireEvent.click(steer[0]);
    expect(onSteer).toHaveBeenCalledWith('second');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('hides steer when the turn is not in flight and disables it for viewers', () => {
    const onSteer = vi.fn();
    const { unmount } = render(() => (
      <QueuedPrompts
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />
    ));
    expect(screen.queryByRole('button', { name: 'Steer' })).toBeNull();
    unmount();

    render(() => (
      <QueuedPrompts
        disabled
        items={[
          { actionId: 'queued-1', kind: 'prompt', prompt: 'Queued request' },
        ]}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onSteer={onSteer}
      />
    ));
    const steer = screen.getByRole('button', {
      name: 'Steer',
    }) as HTMLButtonElement;
    expect(steer.disabled).toBe(true);
    fireEvent.click(steer);
    expect(onSteer).not.toHaveBeenCalled();
  });
});

it('hides private context in the queue and preserves it when editing', () => {
  const prefix =
    '<m-agent-context>{"version":1,"text":"Private instructions"}</m-agent-context>\n\n';
  const onEdit = vi.fn();
  const view = render(() => (
    <QueuedPrompts
      items={[
        {
          actionId: 'queued-context',
          kind: 'prompt',
          prompt: prefix + 'Queued request',
        },
      ]}
      onEdit={onEdit}
      onRemove={() => {}}
    />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Queued request' }));
  expect(view.getByRole('textbox').textContent).toBe('Queued request');
  editor.markdown = 'Updated request';
  editor.change?.('Updated request');
  fireEvent.focusOut(view.getByRole('textbox'));
  expect(onEdit).toHaveBeenCalledWith(
    'queued-context',
    prefix + 'Updated request'
  );
});
