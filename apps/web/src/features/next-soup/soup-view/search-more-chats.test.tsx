import { fireEvent, render, screen } from '@solidjs/testing-library';
import { expect, it, vi } from 'vitest';
import { SearchMoreChats } from './search-more-chats';

it('says how many chats wait behind it and shows them when pressed', () => {
  const onShow = vi.fn();
  render(() => <SearchMoreChats count={11} onShow={onShow} />);

  fireEvent.click(screen.getByRole('button', { name: '11 more chats' }));

  expect(onShow).toHaveBeenCalledOnce();
});

it('names a single chat in the singular', () => {
  render(() => <SearchMoreChats count={1} onShow={() => {}} />);

  expect(screen.getByRole('button', { name: '1 more chat' })).toBeTruthy();
});
