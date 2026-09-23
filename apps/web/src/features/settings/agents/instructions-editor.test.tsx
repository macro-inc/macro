import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  getNearestEditorFromDOMNode,
} from 'lexical';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentInstructionsEditor } from './instructions-editor';

// Shared editor imports include websocket adapters. The editor itself and its
// Markdown transforms remain real; these tests do not connect to app services.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

class ResizeObserverStub implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentInstructionsEditor', () => {
  it('keeps an empty draft unchanged after deferred initialization and publishes the first edit', async () => {
    const [markdown, setMarkdown] = createSignal('');
    const onChange = vi.fn((value: string) => setMarkdown(value));
    render(() => (
      <AgentInstructionsEditor markdown={markdown()} onChange={onChange} />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.querySelector('p')).toBeTruthy());
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(markdown()).toBe('');
    expect(onChange).not.toHaveBeenCalled();

    const editor = getNearestEditorFromDOMNode(textbox);
    if (!editor) throw new Error('Expected the instructions editor');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
        paragraph.append($createTextNode('Research carefully.'));
      },
      { discrete: true }
    );
    await waitFor(() => expect(markdown()).toContain('Research carefully.'));
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('renders saved Markdown without replacing the saved string during initialization', async () => {
    const onChange = vi.fn();
    render(() => (
      <AgentInstructionsEditor
        markdown={
          '## Research\n\nKeep **evidence**.\n\n- Cite sources\n- Compare claims'
        }
        onChange={onChange}
      />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.querySelector('h2')).toBeTruthy());
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(textbox.querySelector('strong')?.textContent).toBe('evidence');
    expect(textbox.querySelectorAll('li')).toHaveLength(2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('publishes edited Markdown and retains the same editor when the host accepts it', async () => {
    const [markdown, setMarkdown] = createSignal('Use **evidence**.');
    const onChange = vi.fn((value: string) => setMarkdown(value));
    render(() => (
      <AgentInstructionsEditor markdown={markdown()} onChange={onChange} />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.textContent).toContain('evidence'));
    const editor = getNearestEditorFromDOMNode(textbox);
    if (!editor) throw new Error('Expected the instructions editor');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
        paragraph.append($createTextNode(' Cite sources.'));
      },
      { discrete: true }
    );
    await waitFor(() => expect(markdown()).toContain('Cite sources.'));
    expect(markdown()).toContain('**evidence**');
    expect(onChange).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(textbox);
    expect(getNearestEditorFromDOMNode(textbox)).toBe(editor);
  });

  it('exports links as standard Markdown without rebuilding their nodes when the host accepts it', async () => {
    const initialMarkdown = 'Read [the source](https://example.com/source).';
    const [markdown, setMarkdown] = createSignal(initialMarkdown);
    const onChange = vi.fn((value: string) => setMarkdown(value));
    render(() => (
      <AgentInstructionsEditor markdown={markdown()} onChange={onChange} />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.querySelector('a')).toBeTruthy());
    const link = textbox.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/source');
    expect(markdown()).toBe(initialMarkdown);
    expect(onChange).not.toHaveBeenCalled();

    const editor = getNearestEditorFromDOMNode(textbox);
    if (!editor) throw new Error('Expected the instructions editor');
    editor.update(
      () => {
        const paragraph = $getRoot().getFirstChild();
        if (!$isElementNode(paragraph)) throw new Error('Expected paragraph');
        paragraph.append($createTextNode(' Compare the findings.'));
      },
      { discrete: true }
    );
    await waitFor(() => expect(markdown()).toContain('Compare the findings.'));
    expect(markdown()).toBe(`${initialMarkdown} Compare the findings.`);
    expect(onChange).toHaveBeenCalledOnce();
    expect(textbox.querySelector('a')).toBe(link);
    expect(getNearestEditorFromDOMNode(textbox)).toBe(editor);
  });

  it('replaces a starter example in place without treating normalization as another edit', async () => {
    const [markdown, setMarkdown] = createSignal('Plain instructions');
    const onChange = vi.fn();
    render(() => (
      <AgentInstructionsEditor markdown={markdown()} onChange={onChange} />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.textContent).toBe('Plain instructions'));
    setMarkdown('## Research\n\n* Cite sources\n* Compare claims');
    await waitFor(() => expect(textbox.querySelectorAll('li')).toHaveLength(2));
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(textbox);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('disables editing without losing content or replacing the editor', async () => {
    const [disabled, setDisabled] = createSignal(false);
    render(() => (
      <AgentInstructionsEditor
        markdown="Keep these instructions."
        onChange={vi.fn()}
        disabled={disabled()}
      />
    ));
    const textbox = screen.getByRole('textbox', { name: 'Instructions' });
    await waitFor(() => expect(textbox.textContent).toContain('Keep these'));
    const editor = getNearestEditorFromDOMNode(textbox);
    if (!editor) throw new Error('Expected the instructions editor');
    setDisabled(true);
    expect(editor.isEditable()).toBe(false);
    expect(textbox.getAttribute('contenteditable')).toBe('false');
    expect(textbox.getAttribute('aria-disabled')).toBe('true');
    setDisabled(false);
    expect(editor.isEditable()).toBe(true);
    expect(textbox.getAttribute('aria-disabled')).toBe('false');
    expect(textbox.textContent).toContain('Keep these instructions.');
    expect(screen.getByRole('textbox', { name: 'Instructions' })).toBe(textbox);
  });
});
