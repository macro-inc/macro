import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $getRoot, $isParagraphNode, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { SupportedNodeTypes } from '../node-list';
import {
  $isCursorSystemNotificationNode,
  CursorSystemNotificationNode,
} from '../nodes/CursorSystemNotificationNode';
import { ALL_TRANSFORMERS, EXTERNAL_TRANSFORMERS } from '../transformers';
import { markdownToPlainText } from '../utils/parsers';

const CI_NOTIFICATION = [
  '<system_notification source="github" repo="github.com/macro-inc/macro" commit="ca515d369476de0a33eef36b21724175e2f6bed3" branch="cursor/settings-menu-search-1f17" conclusion="success" checks="27" subscriptionId="sub_7a13eaab-eee7-4339-a8d3-31c3182150b2" subscriptionType="github:ci:branch">',
  'All 27 CI checks completed without failures.',
  '</system_notification>',
].join('\n');

function editorWith(markdown: string, transformers = ALL_TRANSFORMERS) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  editor.update(
    () => {
      $convertFromMarkdownString(markdown, transformers);
    },
    { discrete: true }
  );
  return editor;
}

function topLevel(editor: ReturnType<typeof createEditor>) {
  return editor.getEditorState().read(() => $getRoot().getChildren());
}

function topLevelText(editor: ReturnType<typeof createEditor>) {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((node) => node.getTextContent())
  );
}

function exported(editor: ReturnType<typeof createEditor>) {
  return editor
    .getEditorState()
    .read(() => $convertToMarkdownString(ALL_TRANSFORMERS));
}

describe('system notification', () => {
  it('reads the CI notification Cursor writes into a prompt', () => {
    const editor = editorWith(CI_NOTIFICATION);
    const [node] = topLevel(editor);
    expect(node).toBeInstanceOf(CursorSystemNotificationNode);
    if (!$isCursorSystemNotificationNode(node)) throw new Error('unreachable');
    expect(node.getSource()).toBe('github');
    expect(node.getText()).toBe('All 27 CI checks completed without failures.');
    expect(node.getAttributes()).toEqual({
      repo: 'github.com/macro-inc/macro',
      commit: 'ca515d369476de0a33eef36b21724175e2f6bed3',
      branch: 'cursor/settings-menu-search-1f17',
      conclusion: 'success',
      checks: '27',
      subscriptionId: 'sub_7a13eaab-eee7-4339-a8d3-31c3182150b2',
      subscriptionType: 'github:ci:branch',
    });
  });

  it('round-trips through internal markdown unchanged', () => {
    const editor = editorWith(CI_NOTIFICATION);
    expect(exported(editor)).toBe(CI_NOTIFICATION);
  });

  it('keeps the prose around it', () => {
    const editor = editorWith(
      `Waiting on CI.\n\n${CI_NOTIFICATION}\n\nThat green result is for the merge commit.`
    );
    const nodes = topLevel(editor);
    expect(nodes.map((node) => node.getType())).toEqual([
      'paragraph',
      'system-notification',
      'paragraph',
    ]);
    expect(topLevelText(editor)).toEqual([
      'Waiting on CI.',
      'All 27 CI checks completed without failures.',
      'That green result is for the merge commit.',
    ]);
  });

  it('accepts a notification written on one line and a multi-line body', () => {
    const oneLine = editorWith(
      '<system_notification source="timer" subscriptionType="timer">Timer fired.</system_notification>'
    );
    const [single] = topLevel(oneLine);
    if (!$isCursorSystemNotificationNode(single))
      throw new Error('expected a card');
    expect(single.getSource()).toBe('timer');
    expect(single.getText()).toBe('Timer fired.');

    const multi = editorWith(
      '<system_notification source="slack" channel="#eng">\nFirst line.\n\nSecond paragraph.\n</system_notification>'
    );
    const [card] = topLevel(multi);
    if (!$isCursorSystemNotificationNode(card))
      throw new Error('expected a card');
    expect(card.getText()).toBe('First line.\n\nSecond paragraph.');
  });

  it('reads a tag that went through a markdown export as plain text', () => {
    // Underscores escaped and the bare repository host autolinked, the way
    // an editor exports a notification someone pasted in as text.
    const escaped = [
      '<system\\_notification source="github" repo="<m-link>{"url":"https://github.com/macro-inc/macro","text":"github.com/macro-inc/macro","title":""}</m-link>" subscriptionId="sub\\_7a13" subscriptionType="github:ci:branch">',
      'All 27 CI checks completed without failures.',
      '</system\\_notification>',
    ].join('\n');
    const [node] = topLevel(editorWith(escaped));
    if (!$isCursorSystemNotificationNode(node))
      throw new Error('expected a card');
    expect(node.getAttributes()).toMatchObject({
      repo: 'github.com/macro-inc/macro',
      subscriptionId: 'sub_7a13',
    });
  });

  it('leaves a tag without a source, or without a close, as text', () => {
    const noSource = editorWith(
      '<system_notification kind="x">\nBody.\n</system_notification>'
    );
    expect(topLevel(noSource).every($isParagraphNode)).toBe(true);
    expect(topLevel(noSource).some($isCursorSystemNotificationNode)).toBe(
      false
    );

    const unclosed = editorWith(
      '<system_notification source="github">\nStill streaming'
    );
    expect(topLevel(unclosed).some($isCursorSystemNotificationNode)).toBe(
      false
    );
    expect(topLevelText(unclosed).join('\n')).toContain(
      '<system_notification source="github">'
    );
  });

  it('leaves a tag quoted inside a code fence as code', () => {
    const editor = editorWith(
      ['```', ...CI_NOTIFICATION.split('\n'), '```'].join('\n')
    );
    const nodes = topLevel(editor);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.getType()).toBe('code');
    expect(nodes.some($isCursorSystemNotificationNode)).toBe(false);
  });

  it('is an internal-format node; external markdown leaves it as text', () => {
    const editor = editorWith(CI_NOTIFICATION, EXTERNAL_TRANSFORMERS);
    expect(topLevel(editor).some($isCursorSystemNotificationNode)).toBe(false);
  });

  it('reads as its summary in plain text', () => {
    expect(markdownToPlainText(`Heads up:\n${CI_NOTIFICATION}`)).toBe(
      'Heads up:\nAll 27 CI checks completed without failures.'
    );
  });
});
