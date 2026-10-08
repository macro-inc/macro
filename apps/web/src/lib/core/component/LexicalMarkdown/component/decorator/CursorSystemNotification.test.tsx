/**
 * @vitest-environment jsdom
 */

import { fireEvent, render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CursorSystemNotification,
  conclusionTone,
  details,
  kindLabel,
  sourceLabel,
} from './CursorSystemNotification';

const mocks = vi.hoisted(() => ({ openExternalUrl: vi.fn() }));
vi.mock('@core/util/url', () => ({ openExternalUrl: mocks.openExternalUrl }));

const ci = {
  key: 'k',
  theme: {},
  source: 'github',
  text: 'All 27 CI checks completed without failures.',
  attributes: {
    repo: 'github.com/macro-inc/macro',
    commit: 'ca515d369476de0a33eef36b21724175e2f6bed3',
    branch: 'cursor/settings-menu-search-1f17',
    conclusion: 'success',
    checks: '27',
    subscriptionId: 'sub_7a13eaab-eee7-4339-a8d3-31c3182150b2',
    subscriptionType: 'github:ci:branch',
  },
};

beforeEach(() => {
  mocks.openExternalUrl.mockReset();
});

describe('CursorSystemNotification', () => {
  it('reads a CI result as a GitHub card with its summary and a pass pill', () => {
    const view = render(() => <CursorSystemNotification {...ci} />);
    const card = view.getByRole('region', { name: 'GitHub notification' });
    expect(card.textContent).toContain('GitHub');
    expect(card.textContent).toContain('CI checks');
    expect(card.textContent).toContain(
      'All 27 CI checks completed without failures.'
    );
    expect(card.querySelector('[data-tone]')?.getAttribute('data-tone')).toBe(
      'success'
    );
    expect(card.textContent).toContain('Success');
  });

  it('shows the repository, branch, short commit and check count, and hides the subscription id', () => {
    const view = render(() => <CursorSystemNotification {...ci} />);
    const card = view.getByRole('region');
    expect(card.textContent).toContain('macro-inc/macro');
    expect(card.textContent).toContain('cursor/settings-menu-search-1f17');
    expect(card.textContent).toContain('ca515d3');
    expect(card.textContent).not.toContain(
      'ca515d369476de0a33eef36b21724175e2f6bed3'
    );
    expect(card.textContent).toContain('27 checks');
    expect(card.textContent).not.toContain('sub_7a13eaab');
    expect(card.textContent).not.toContain('github:ci:branch');
  });

  it('opens the commit on GitHub from its chip', () => {
    const view = render(() => <CursorSystemNotification {...ci} />);
    fireEvent.click(view.getByText('ca515d3'));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/macro-inc/macro/commit/ca515d369476de0a33eef36b21724175e2f6bed3'
    );
    fireEvent.click(view.getByText('macro-inc/macro'));
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(
      'https://github.com/macro-inc/macro'
    );
  });

  it('lists attributes it has no face for as name: value chips', () => {
    const view = render(() => (
      <CursorSystemNotification
        key="k"
        theme={{}}
        source="linear"
        text="Issue moved to In Progress."
        attributes={{
          issue: 'MAC-123',
          subscriptionType: 'linear:issue',
          subscriptionId: 'sub_x',
        }}
      />
    ));
    const card = view.getByRole('region', { name: 'Linear notification' });
    expect(card.textContent).toContain('Issue update');
    expect(card.textContent).toContain('issue: MAC-123');
    expect(card.textContent).not.toContain('sub_x');
    expect(card.querySelector('[data-tone]')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'javascript://example.com/%0aalert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://',
  ])('does not render actionable links for %s', (url) => {
    const view = render(() => (
      <CursorSystemNotification
        {...ci}
        attributes={{ repo: url, commit: ci.attributes.commit, url }}
      />
    ));
    expect(view.queryAllByRole('link')).toHaveLength(0);
    fireEvent.click(view.getByText('ca515d3'));
    expect(mocks.openExternalUrl).not.toHaveBeenCalled();
    expect(
      details({ repository: url, link: url, sha: ci.attributes.commit }).every(
        (detail) => detail.href === undefined
      )
    ).toBe(true);
  });

  it.each(['http://example.com/event', 'https://example.com/event'])(
    'opens an HTTP event link: %s',
    (url) => {
      const view = render(() => (
        <CursorSystemNotification {...ci} attributes={{ link: url }} />
      ));
      fireEvent.click(view.getByRole('link', { name: 'Open' }));
      expect(mocks.openExternalUrl).toHaveBeenCalledWith(url);
    }
  );
});

describe('labels', () => {
  it('names known sources and title-cases the rest', () => {
    expect(sourceLabel('github')).toBe('GitHub');
    expect(sourceLabel('slack')).toBe('Slack');
    expect(sourceLabel('jira')).toBe('Jira');
    expect(sourceLabel('')).toBe('System');
  });

  it('reads a subscription type as words', () => {
    expect(kindLabel('github:ci:branch')).toBe('CI checks');
    expect(kindLabel('slack:thread')).toBe('Thread reply');
    expect(kindLabel('timer')).toBe('Timer');
    expect(kindLabel('github:release_published')).toBe('Release published');
    expect(kindLabel(undefined)).toBe('Notification');
  });

  it('colours a conclusion by outcome', () => {
    expect(conclusionTone('success')).toBe('success');
    expect(conclusionTone('failure')).toBe('failure');
    expect(conclusionTone('timed_out')).toBe('failure');
    expect(conclusionTone('neutral')).toBe('neutral');
    expect(conclusionTone(undefined)).toBe('neutral');
  });

  it('links a commit only when it knows the repository', () => {
    expect(details({ commit: 'abcdef0123456789' })).toEqual([
      expect.objectContaining({ label: 'abcdef0', href: undefined }),
    ]);
    expect(details({ checks: '1' })[0]?.label).toBe('1 check');
  });
});
