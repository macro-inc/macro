import { describe, expect, it } from 'vitest';
import type { Changeset } from './changeset';
import {
  buildPullRequestPrompt,
  initialPullRequestForm,
  parseReviewers,
  pullRequestNumber,
} from './pull-request';

const changeset: Changeset = {
  id: 'cs',
  repository: 'https://github.com/macro-inc/macro',
  base: { name: 'main' },
  head: { name: 'agent/x' },
  files: [],
  additions: 0,
  deletions: 0,
  patchBytes: 0,
  truncated: false,
  capturedAt: 't',
};

describe('initialPullRequestForm', () => {
  it('starts from the draft and the changeset base', () => {
    expect(
      initialPullRequestForm({ title: 'T', body: 'B' }, changeset, {
        draft: true,
      })
    ).toEqual({
      title: 'T',
      body: 'B',
      base: 'main',
      reviewers: [],
      draft: true,
    });
  });
});

describe('parseReviewers', () => {
  it('splits on commas and spaces, drops @ and duplicates', () => {
    expect(parseReviewers('@jamie-l, rk  rk\n@jamie-l')).toEqual([
      'jamie-l',
      'rk',
    ]);
    expect(parseReviewers('')).toEqual([]);
  });
});

describe('buildPullRequestPrompt', () => {
  it('spells out every decision and asks for the link back', () => {
    const prompt = buildPullRequestPrompt(
      {
        title: 'Clear the unread dot',
        body: 'Why.\n\n## Test plan\n- ran it',
        base: 'main',
        reviewers: ['jamie-l'],
        draft: true,
      },
      changeset
    );
    expect(prompt).toContain('Open a draft pull request');
    expect(prompt).toContain('- Head branch: `agent/x`');
    expect(prompt).toContain('- Base branch: `main`');
    expect(prompt).toContain('- Request reviews from: @jamie-l');
    expect(prompt).toContain('- Title: Clear the unread dot');
    expect(prompt).toContain(
      '```markdown\nWhy.\n\n## Test plan\n- ran it\n```'
    );
    expect(prompt).toContain('`set_pull_request`');
  });

  it('lengthens the fence around a body that has one', () => {
    const prompt = buildPullRequestPrompt(
      {
        title: 'T',
        body: 'Run:\n```sh\nbun test\n```',
        base: '',
        reviewers: [],
        draft: false,
      },
      changeset
    );
    expect(prompt).toContain('````markdown\nRun:\n```sh\nbun test\n```\n````');
    expect(prompt).not.toContain('Base branch');
  });
});

describe('pullRequestNumber', () => {
  it('reads the number out of a pull request url', () => {
    expect(pullRequestNumber('https://github.com/a/b/pull/1482')).toBe(1482);
    expect(pullRequestNumber('https://github.com/a/b/pull/12/files')).toBe(12);
    expect(pullRequestNumber('https://github.com/a/b')).toBeUndefined();
  });
});
