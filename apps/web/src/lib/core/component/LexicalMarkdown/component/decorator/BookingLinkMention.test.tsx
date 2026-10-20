import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openExternalUrl: vi.fn(),
  writeText: vi.fn(async () => undefined),
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
}));

vi.mock('@core/util/url', () => ({
  openExternalUrl: mocks.openExternalUrl,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.toastSuccess, failure: mocks.toastFailure },
}));
vi.mock('@core/component/HoverCard', () => ({
  HoverCard: (props: { trigger: JSX.Element; content: JSX.Element }) => (
    <>
      {props.trigger}
      {props.content}
    </>
  ),
}));
vi.mock('../../plugins', () => ({ autoRegister: vi.fn() }));

import { BookingLinkMention } from './BookingLinkMention';

const url = 'https://macro.com/app/book/profile/jacob-s-booking-link';

function renderMention() {
  return render(() => (
    <BookingLinkMention
      key="node"
      profileId="profile"
      slug="jacob-s-booking-link"
      label="jacob-s-booking-link"
      url={url}
      theme={{}}
    />
  ));
}

beforeEach(() => {
  mocks.openExternalUrl.mockReset();
  mocks.writeText.mockReset();
  mocks.writeText.mockResolvedValue(undefined);
  mocks.toastSuccess.mockReset();
  mocks.toastFailure.mockReset();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
});

describe('booking link mention', () => {
  it('is a link to the booking page', () => {
    renderMention();

    const chip = screen.getByRole('link', { name: /jacob-s-booking-link/ });
    expect(chip.getAttribute('href')).toBe(url);

    fireEvent.click(chip);
    expect(mocks.openExternalUrl).toHaveBeenCalledWith(url);
  });

  it('copies the booking url from the chip preview', async () => {
    renderMention();

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    await waitFor(() => {
      expect(mocks.writeText).toHaveBeenCalledWith(url);
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('Link copied to clipboard');
  });
});
