import { registerRichText } from '@lexical/rich-text';
import {
  $createDatabaseQueryNode,
  DatabaseQueryNode,
} from '@macro-inc/lexical-core/nodes/DatabaseQueryNode';
import { fireEvent, render, waitFor } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isRangeSelection,
  CLICK_COMMAND,
  createEditor,
  type LexicalEditor,
  ParagraphNode,
  TextNode,
} from 'lexical';
import { createSignal, type JSX, onCleanup } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it, vi } from 'vitest';
import {
  type LexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import {
  defaultSelectionData,
  type SelectionData,
} from '../../plugins/selection-data/selectionDataPlugin';
import { DatabaseQuery } from './DatabaseQuery';

const control = vi.hoisted(() => ({
  enabled: (): boolean => false,
  mounts: 0,
  cleanups: 0,
  clicks: 0,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableDatabases: { key: 'enable-databases' },
}));
vi.mock('../../context/LexicalWrapperContext', async () => ({
  LexicalWrapperContext: (await import('solid-js')).createContext(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: control.enabled() }),
}));
vi.mock('./LazyDecorator', () => ({
  LazyDecorator: (props: { render: () => JSX.Element }) => props.render(),
}));
vi.mock('@app/features/database-query/database-query', () => ({
  DatabaseLiveQuestion: (props: { source: { displayMode: string } }) => {
    control.mounts++;
    onCleanup(() => control.cleanups++);
    if (props.source.displayMode === 'scalar')
      return <span>Interactive answer</span>;
    return (
      <div contentEditable={false}>
        <div data-testid="header">
          <span>RSVP Counts</span>
          <button type="button" onClick={() => control.clicks++}>
            Details
          </button>
        </div>
        <details>
          <summary>View data</summary>
        </details>
        <table>
          <tbody>
            <tr>
              <td>Diwali Dinner</td>
            </tr>
          </tbody>
        </table>
        <a href="https://macro.com">Party Planner</a>
      </div>
    );
  },
}));

describe('database answer rollout', () => {
  it('keeps the saved title without mounting live query wiring when disabled', async () => {
    const [enabled, setEnabled] = createSignal(false);
    control.enabled = enabled;
    control.mounts = 0;
    control.cleanups = 0;
    const rendered = render(() => (
      <DatabaseQuery
        key="query"
        theme={{}}
        queryId="saved-query"
        prompt="How many?"
        title="Open tickets"
        displayMode="scalar"
      />
    ));
    expect(rendered.getByText('Open tickets')).toBeTruthy();
    expect(control.mounts).toBe(0);
    setEnabled(true);
    await waitFor(() =>
      expect(rendered.getByText('Interactive answer')).toBeTruthy()
    );
    expect(control.mounts).toBe(1);
    setEnabled(false);
    expect(rendered.getByText('Open tickets')).toBeTruthy();
    expect(control.cleanups).toBe(1);
    rendered.unmount();
  });
});

function createTestEditor() {
  const editor = createEditor({
    namespace: 'database-query-decorator-test',
    nodes: [ParagraphNode, TextNode, DatabaseQueryNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  // jsdom only focuses a contenteditable that also has a tab index.
  root.tabIndex = 0;
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('Above')),
          $createDatabaseQueryNode({
            queryId: 'query',
            prompt: 'RSVP counts',
            displayMode: 'table',
          }),
          $createParagraphNode().append($createTextNode('Below'))
        );
      $getRoot().getFirstChildOrThrow().selectEnd();
    },
    { discrete: true }
  );
  const [selection, setSelection] = createStore<SelectionData>(
    structuredClone(defaultSelectionData)
  );
  editor.registerUpdateListener(({ editorState }) => {
    editorState.read(() => {
      const current = $getSelection();
      setSelection({
        type: $isNodeSelection(current)
          ? 'node'
          : $isRangeSelection(current)
            ? 'range'
            : null,
        nodeKeys: new Set(
          $isNodeSelection(current)
            ? current.getNodes().map((node) => node.getKey())
            : []
        ),
      });
    });
  });
  const blockKey = editor.read(() => $getRoot().getChildAtIndex(1)!.getKey());
  const wrapper = {
    editor,
    selection,
    isInteractable: () => true,
  } as unknown as LexicalWrapper;
  return { editor, root, wrapper, blockKey };
}

function selected(editor: LexicalEditor) {
  return editor.read(() => {
    const selection = $getSelection();
    if ($isNodeSelection(selection))
      return { node: selection.getNodes()[0]?.getType() };
    if ($isRangeSelection(selection))
      return { text: selection.anchor.getNode().getTextContent() };
    return null;
  });
}

function renderBlock(test: ReturnType<typeof createTestEditor>) {
  control.enabled = () => true;
  return render(() => (
    <LexicalWrapperContext.Provider value={test.wrapper}>
      <DatabaseQuery
        key={test.blockKey}
        theme={{}}
        queryId="query"
        prompt="RSVP counts"
        title="RSVP counts placeholder"
        displayMode="table"
      />
    </LexicalWrapperContext.Provider>
  ));
}

describe('database answer while databases are off', () => {
  it('renders the placeholder in a live editor and leaves the node as saved', () => {
    const test = createTestEditor();
    const saved = test.editor.getEditorState().toJSON();
    control.enabled = () => false;
    control.mounts = 0;
    const rendered = render(() => (
      <LexicalWrapperContext.Provider value={test.wrapper}>
        <DatabaseQuery
          key={test.blockKey}
          theme={{}}
          queryId="query"
          prompt="RSVP counts"
          title="RSVP counts placeholder"
          displayMode="table"
        />
      </LexicalWrapperContext.Provider>
    ));
    expect(rendered.getByText('RSVP counts placeholder')).toBeTruthy();
    expect(control.mounts).toBe(0);
    fireEvent.mouseDown(rendered.getByText('RSVP counts placeholder'), {
      button: 0,
    });
    expect(test.editor.getEditorState().toJSON()).toEqual(saved);
    rendered.unmount();
    test.root.remove();
  });
});

describe('database controls in a composer shell', () => {
  it('lets delegated clicks reach embedded controls without stealing focus', async () => {
    const test = createTestEditor();
    control.enabled = () => true;
    control.clicks = 0;
    const focus = vi.fn();
    const rendered = render(() => (
      <div
        on:click={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-lexical-interactive]')
          )
            return;
          event.stopPropagation();
          focus();
        }}
      >
        <LexicalWrapperContext.Provider value={test.wrapper}>
          <DatabaseQuery
            key={test.blockKey}
            theme={{}}
            queryId="query"
            prompt="Count"
            displayMode="table"
          />
        </LexicalWrapperContext.Provider>
      </div>
    ));
    const details = await rendered.findByRole('button', { name: 'Details' });
    details.focus();
    fireEvent.click(details);
    expect(control.clicks).toBe(1);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(details);
    rendered.unmount();
    test.root.remove();
  });
});

describe('pressing a database answer block', () => {
  it('selects the block on the press itself, without placing a caret first', async () => {
    const test = createTestEditor();
    const rendered = renderBlock(test);
    expect(selected(test.editor)).toEqual({ text: 'Above' });
    const title = (await rendered.findByTestId('header')).querySelector(
      'span'
    )!;
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    title.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(selected(test.editor)).toEqual({ node: 'database-query' })
    );
    expect(document.activeElement).toBe(test.root);
    await waitFor(() =>
      expect(
        rendered.container.querySelector('[data-database-query-selected]')
      ).toBeTruthy()
    );
    rendered.unmount();
    test.root.remove();
  });

  it('selects the block from the spacing around its card', async () => {
    const test = createTestEditor();
    const rendered = renderBlock(test);
    const spacing = rendered.container.querySelector('.py-1');
    expect(spacing).toBeTruthy();
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    spacing!.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await waitFor(() =>
      expect(selected(test.editor)).toEqual({ node: 'database-query' })
    );
    rendered.unmount();
    test.root.remove();
  });

  it('keeps a table cell’s text selectable while selecting the block', async () => {
    const test = createTestEditor();
    const rendered = renderBlock(test);
    const press = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    (await rendered.findByText('Diwali Dinner')).dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    await waitFor(() =>
      expect(selected(test.editor)).toEqual({ node: 'database-query' })
    );
    rendered.unmount();
    test.root.remove();
  });

  it.each(['Details', 'View data', 'Party Planner'])(
    'leaves a press on %s to that control',
    async (name) => {
      const test = createTestEditor();
      const rendered = renderBlock(test);
      const press = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
      });
      (await rendered.findByText(name)).dispatchEvent(press);
      expect(press.defaultPrevented).toBe(false);
      expect(selected(test.editor)).toEqual({ text: 'Above' });
      rendered.unmount();
      test.root.remove();
    }
  );

  it('survives the editor turning read-only and back', async () => {
    const test = createTestEditor();
    const rendered = renderBlock(test);
    expect(() => {
      test.editor.setEditable(false);
      test.editor.setEditable(true);
      test.editor.setEditable(false);
    }).not.toThrow();
    fireEvent.mouseDown(
      (await rendered.findByTestId('header')).querySelector('span')!
    );
    expect(selected(test.editor)).toEqual({ text: 'Above' });
    rendered.unmount();
    test.root.remove();
  });

  it('stays selected through the click that ends the press', async () => {
    const test = createTestEditor();
    const rendered = renderBlock(test);
    const title = (await rendered.findByTestId('header')).querySelector(
      'span'
    )!;
    fireEvent.mouseDown(title);
    await waitFor(() =>
      expect(selected(test.editor)).toEqual({ node: 'database-query' })
    );
    // Lexical's own click handling clears a node selection first, as it does
    // for every click in the document.
    test.editor.update(
      () => {
        test.editor.dispatchCommand(CLICK_COMMAND, new MouseEvent('click'));
      },
      { discrete: true }
    );
    expect(selected(test.editor)).toBeNull();
    fireEvent.click(title);
    await waitFor(() =>
      expect(selected(test.editor)).toEqual({ node: 'database-query' })
    );
    rendered.unmount();
    test.root.remove();
  });
});
