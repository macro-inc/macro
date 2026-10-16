// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isGithubPullRequestUrl } from '../nodes/PullRequestMentionNode';
import {
  markdownToSerializedEditorStateWithIds,
  serializedEditorStateToMarkdown,
} from '../utils/markdown-state';
import { markdownToEmbeddingText, markdownToPlainText } from '../utils/parsers';

const PR_URL = 'https://github.com/macro-inc/macro/pull/7945';

describe('PullRequestMentionNode', () => {
  it('round-trips a Macro id mention', () => {
    const markdown =
      '<m-pr-mention>{"id":"foreign-1","label":"macro-inc/macro#7945"}</m-pr-mention>';
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [{ type: 'pr-mention', id: 'foreign-1' }],
    });
    expect(serializedEditorStateToMarkdown(state)).toBe(markdown);
  });

  it('accepts a GitHub URL in place of the Macro id', () => {
    const markdown = `<m-pr-mention>{"url":"${PR_URL}","label":""}</m-pr-mention>`;
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [{ type: 'pr-mention', id: '', url: PR_URL }],
    });

    const exported = serializedEditorStateToMarkdown(state);
    expect(markdownToSerializedEditorStateWithIds(exported).root).toMatchObject(
      {
        children: [{ children: [{ type: 'pr-mention', id: '', url: PR_URL }] }],
      }
    );
    expect(markdownToPlainText(markdown)).toBe('macro-inc/macro#7945');
    expect(markdownToEmbeddingText(markdown)).toBe(
      `[macro-inc/macro#7945](${PR_URL})`
    );
  });

  it('reads a GitHub URL written as the id as the mention URL', () => {
    const markdown = `<m-pr-mention>{"id":"${PR_URL}","label":""}</m-pr-mention>`;
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(state.root.children[0]).toMatchObject({
      children: [{ type: 'pr-mention', id: '', url: PR_URL }],
    });
  });

  it('rejects a mention with neither an id nor a GitHub PR URL', () => {
    const markdown =
      '<m-pr-mention>{"url":"https://example.com/pull/1","label":""}</m-pr-mention>';
    const state = markdownToSerializedEditorStateWithIds(markdown);
    expect(JSON.stringify(state)).not.toContain('"type":"pr-mention"');
  });
});

describe('isGithubPullRequestUrl', () => {
  it.each([
    PR_URL,
    `${PR_URL}/files`,
    `${PR_URL}#issuecomment-1`,
    'https://www.github.com/macro-inc/macro/pull/7945',
  ])('accepts %s', (url) => {
    expect(isGithubPullRequestUrl(url)).toBe(true);
  });

  it.each([
    'https://github.com/macro-inc/macro/issues/7945',
    'https://github.com/macro-inc/macro/pull/7945abc',
    'https://evil.example/github.com/macro-inc/macro/pull/7945',
    'javascript:alert(1)//github.com/a/b/pull/1',
  ])('rejects %s', (url) => {
    expect(isGithubPullRequestUrl(url)).toBe(false);
  });
});
