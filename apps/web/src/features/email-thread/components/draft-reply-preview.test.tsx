import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { DraftReplyPreview } from './draft-reply-preview';

afterEach(cleanup);

it('reopens the draft when tapped and keeps its text out of session replay', () => {
  const onOpen = vi.fn();
  render(() => <DraftReplyPreview text="Sounds good" onOpen={onOpen} />);

  const text = screen.getByText('Sounds good');
  expect(text.classList.contains('ph-no-capture')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Draft/ }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it('says so when the draft has no text yet', () => {
  render(() => <DraftReplyPreview text="" onOpen={() => {}} />);
  expect(screen.getByText('No text yet')).toBeTruthy();
});
