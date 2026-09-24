/** @vitest-environment jsdom */

import type { FailureNotice } from '@service-agent-fold/generated/types';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FailureNoticeCard } from './FailureNoticeCard';

afterEach(cleanup);

const usageLimit: FailureNotice = {
  kind: 'provider_usage_limit',
  title: 'Cursor usage limit reached',
  body: 'Raise the spending limit in your Cursor dashboard, then send it again.',
  link: {
    label: 'Manage Cursor usage',
    url: 'https://www.cursor.com/dashboard?tab=settings',
  },
};

describe('FailureNoticeCard', () => {
  it('shows the title and body the runtime wrote for the person', () => {
    const { getByText } = render(() => (
      <FailureNoticeCard notice={usageLimit} onOpenLink={() => {}} />
    ));

    expect(getByText('Cursor usage limit reached')).toBeTruthy();
    expect(
      getByText(
        'Raise the spending limit in your Cursor dashboard, then send it again.'
      )
    ).toBeTruthy();
  });

  it('opens the link through the caller, with its label as the button', () => {
    const onOpenLink = vi.fn();
    const { getByRole } = render(() => (
      <FailureNoticeCard notice={usageLimit} onOpenLink={onOpenLink} />
    ));

    fireEvent.click(getByRole('button', { name: 'Manage Cursor usage' }));

    expect(onOpenLink).toHaveBeenCalledWith(
      'https://www.cursor.com/dashboard?tab=settings'
    );
  });

  it('offers no button when the notice has nowhere to go', () => {
    const { queryByRole } = render(() => (
      <FailureNoticeCard
        notice={{ ...usageLimit, link: null }}
        onOpenLink={() => {}}
      />
    ));

    expect(queryByRole('button')).toBeNull();
  });
});
