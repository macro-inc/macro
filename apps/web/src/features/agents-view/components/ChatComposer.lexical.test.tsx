import { Telemetry } from '@macro-inc/observability';
import { render, screen, waitFor } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  getNearestEditorFromDOMNode,
  KEY_ENTER_COMMAND,
} from 'lexical';
import { createSignal } from 'solid-js';
import { expect, it, onTestFinished, vi } from 'vitest';
import { ChatComposer } from './ChatComposer';

vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));

// The popup menus need app providers; Enter never opens them here.
vi.mock('@core/component/LexicalMarkdown/component/menu/ActionsMenu', () => ({
  ActionMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingFormatMenu',
  () => ({
    FloatingFormatMenu: () => null,
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingGifMenu',
  () => ({
    FloatingGifMenu: () => null,
  })
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/FloatingLinkMenu',
  () => ({
    FloatingLinkMenu: () => null,
  })
);
vi.mock('@core/component/LexicalMarkdown/component/menu/MentionsMenu', () => ({
  MentionsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/SkillsMenu', () => ({
  SkillsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/SnippetsMenu', () => ({
  SnippetsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/TagsMenu', () => ({
  TagsMenu: () => null,
}));

vi.mock('@core/agent-fold/client', () => ({
  preloadAgentFold: vi.fn(async () => {}),
}));

// Lexical's development build freezes committed state, as in the dev app.
it('sends with Enter without a Lexical error', async () => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  // jsdom has no layout; Lexical measures the caret to scroll it into view.
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => new DOMRect(),
  });
  onTestFinished(() => {
    Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect');
  });
  const errors = vi.spyOn(Telemetry, 'error');
  const [draft, setDraft] = createSignal('');
  const onSend = vi.fn();
  render(() => (
    <ChatComposer
      draft={draft()}
      onDraftChange={setDraft}
      selector={<span />}
      onSend={onSend}
    />
  ));
  const root = await screen.findByRole('textbox', {
    name: 'Message the agent',
  });
  const editor = await waitFor(() => {
    const connected = getNearestEditorFromDOMNode(root);
    if (!connected) throw new Error('editor not connected');
    return connected;
  });
  editor.update(
    () => {
      const paragraph = $createParagraphNode();
      const text = $createTextNode('hello agent');
      paragraph.append(text);
      $getRoot().clear().append(paragraph);
      text.select();
    },
    { discrete: true }
  );
  await waitFor(() => expect(draft()).toBe('hello agent'));
  root.focus();

  // What Lexical's keydown listener dispatches for Enter.
  editor.dispatchCommand(
    KEY_ENTER_COMMAND,
    new KeyboardEvent('keydown', { key: 'Enter' })
  );

  expect(onSend).toHaveBeenCalledWith('hello agent', []);
  await waitFor(() => expect(draft()).toBe(''));
  expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe(
    ''
  );
  expect(errors).not.toHaveBeenCalled();
});
