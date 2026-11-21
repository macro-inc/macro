import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $dfs } from '@lexical/utils';
import {
  $getRoot,
  createEditor,
  type LexicalNode,
  type SerializedEditorState,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import { $isEquationNode } from '../nodes/EquationNode';
import { $isImageNode } from '../nodes/ImageNode';
import { $isVideoNode } from '../nodes/VideoNode';
import { INTERNAL_TRANSFORMERS } from '../transformers';

// Agents read documents as internal markdown and write the text back, so a
// document as stored (Loro keeps an absent field as `null`) must export to
// markdown that imports into the same nodes and exports to the same text.

type SerializedNode = Record<string, unknown> & {
  type: string;
  children?: SerializedNode[];
};

function createTestEditor() {
  return createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
}

function stateOf(children: SerializedNode[]): SerializedEditorState {
  return {
    root: {
      type: 'root',
      version: 1,
      direction: null,
      format: '',
      indent: 0,
      children,
    },
  } as unknown as SerializedEditorState;
}

function exportState(state: SerializedEditorState): string {
  const editor = createTestEditor();
  editor.setEditorState(editor.parseEditorState(state));
  return editor.read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

function importMarkdown(markdown: string) {
  const editor = createTestEditor();
  editor.update(
    () => {
      $getRoot().clear();
      $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS);
    },
    { discrete: true }
  );
  return editor;
}

function nodesOf<T extends LexicalNode>(
  markdown: string,
  guard: (node: LexicalNode | null | undefined) => node is T
): T[] {
  return importMarkdown(markdown).read(() =>
    $dfs()
      .map(({ node }) => node)
      .filter(guard)
  );
}

/** The state an import of `markdown` stores, as Loro hands it back. */
function storedState(markdown: string): SerializedEditorState {
  const editor = importMarkdown(markdown);
  const state = JSON.parse(JSON.stringify(editor.getEditorState().toJSON()));
  const nullAbsentFields = (node: SerializedNode) => {
    if (node.type.endsWith('mention') && !('mentionUuid' in node))
      node.mentionUuid = null;
    node.children?.forEach(nullAbsentFields);
  };
  nullAbsentFields(state.root);
  return state;
}

describe('internal markdown round trip of stored documents', () => {
  it.each([
    [
      'date',
      'Due <m-date-mention>{"date":"2026-11-13","displayFormat":"Fri, Nov 13"}</m-date-mention>',
    ],
    [
      'pull request',
      'See <m-pr-mention>{"id":"foreign-1","label":"macro-inc/macro#7945"}</m-pr-mention>',
    ],
    [
      'agent session',
      'Ask <m-agent-session-mention>{"id":"01a10ac3-013f-72f8-afbb-3bad148dee04","label":"Agent"}</m-agent-session-mention>',
    ],
  ])(
    'exports a stored %s mention without a uuid as its markdown parses',
    (_, markdown) => {
      const parsed = exportState(
        importMarkdown(markdown).getEditorState().toJSON()
      );

      const stored = exportState(storedState(markdown));

      expect(stored).toBe(parsed);
      expect(stored).not.toContain('"mentionUuid":null');
    }
  );

  it('keeps a stored image without a size as the same Macro image', () => {
    const markdown = exportState(
      stateOf([
        {
          type: 'image',
          version: 1,
          url: 'https://signed.example.com/x',
          alt: 'shot',
          srcType: 'dss',
          id: 'img-1',
          width: 0,
          height: 0,
          scale: 1,
          constrainedWidth: null,
          constrainedHeight: null,
        },
      ])
    );

    const [image] = nodesOf(markdown, $isImageNode);
    expect(image?.getSrcType()).toBe('dss');
    expect(image?.getId()).toBe('img-1');
    expect(
      exportState(importMarkdown(markdown).getEditorState().toJSON())
    ).toBe(markdown);
  });

  it('keeps a stored video inside a paragraph', () => {
    const markdown = exportState(
      stateOf([
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          children: [
            {
              type: 'video',
              version: 1,
              url: 'https://videos.example.com/v1',
              srcType: 'embed',
              id: '',
              width: 0,
              height: 0,
              scale: 1,
              controls: true,
              constrainedWidth: null,
              constrainedHeight: null,
            },
          ],
        },
      ])
    );

    const [video] = nodesOf(markdown, $isVideoNode);
    expect(video?.getUrl()).toBe('https://videos.example.com/v1');
    expect(video?.getSrcType()).toBe('embed');
    expect(
      exportState(importMarkdown(markdown).getEditorState().toJSON())
    ).toBe(markdown);
  });

  it('keeps a stored video followed by a line break', () => {
    const markdown = exportState(
      stateOf([
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          children: [
            {
              type: 'video',
              version: 1,
              url: 'https://videos.example.com/v1',
              srcType: 'embed',
              id: '',
              width: 0,
              height: 0,
              scale: 1,
              controls: true,
            },
            { type: 'linebreak', version: 1 },
          ],
        },
      ])
    );

    const [video] = nodesOf(markdown, $isVideoNode);
    expect(video?.getUrl()).toBe('https://videos.example.com/v1');
  });

  it('keeps a paragraph with a display equation tag inline in prose', () => {
    const markdown =
      'Area <m-katex-equation>{"equation":"x^2","inline":false}</m-katex-equation> here';

    expect(nodesOf(markdown, $isEquationNode)).toHaveLength(1);
    expect(
      exportState(importMarkdown(markdown).getEditorState().toJSON())
    ).toBe(markdown);
  });

  it('keeps a line that opens with a display equation and ends with another', () => {
    const markdown =
      '<m-katex-equation>{"equation":"x","inline":false}</m-katex-equation> = <m-katex-equation>{"equation":"y","inline":true}</m-katex-equation>';

    expect(
      nodesOf(markdown, $isEquationNode).map((equation) =>
        equation.getEquation()
      )
    ).toEqual(['x', 'y']);
    expect(
      exportState(importMarkdown(markdown).getEditorState().toJSON())
    ).toBe(markdown);
  });

  it('imports a spaced display equation tag to the top level', () => {
    const editor = importMarkdown(
      '<m-katex-equation>{"equation": "x^2", "inline": false}</m-katex-equation>'
    );
    editor.read(() => {
      const equation = $getRoot().getFirstChild();
      expect($isEquationNode(equation)).toBe(true);
    });
  });

  it('keeps a stored top-level display equation', () => {
    const markdown = exportState(
      stateOf([
        { type: 'equation', version: 1, equation: 'x^2', inline: false },
      ])
    );

    const editor = importMarkdown(markdown);
    editor.read(() => {
      const equation = $getRoot().getFirstChild();
      expect($isEquationNode(equation)).toBe(true);
      if (!$isEquationNode(equation)) return;
      expect(equation.getEquation()).toBe('x^2');
      expect(equation.getInline()).toBe(false);
    });
    expect(
      exportState(importMarkdown(markdown).getEditorState().toJSON())
    ).toBe(markdown);
  });
});
