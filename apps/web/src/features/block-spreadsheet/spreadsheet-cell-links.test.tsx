import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const open = vi.hoisted(() => vi.fn());
vi.mock('@core/util/url', async (original) => ({
  ...(await original<typeof import('@core/util/url')>()),
  openExternalUrl: open,
}));
vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: (url: string) => [
    () => ({ type: 'success', data: { url, title: 'Shared channel preview' } }),
  ],
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: ParentProps) => props.children,
}));
vi.mock('@ui', () => ({
  cn: (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' '),
}));

import { SpreadsheetCellLinks } from './spreadsheet-cell-links';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('links URLs and email addresses in plain cell text with channel hover previews', async () => {
  const text =
    'See https://www.linkedin.com/in/sridiptoghosh/, then https://x.com/example. Email future@antimattr.one; support@antimattr.one';
  render(() => <SpreadsheetCellLinks value={text} />);
  const links = screen.getAllByRole('link');
  expect(links.map((a) => a.getAttribute('href'))).toEqual([
    'https://www.linkedin.com/in/sridiptoghosh/',
    'https://x.com/example',
    'mailto:future@antimattr.one',
    'mailto:support@antimattr.one',
  ]);
  expect(document.body.textContent).toBe(text);
  fireEvent.mouseEnter(links[0]);
  await screen.findByText('Shared channel preview');
  fireEvent.mouseLeave(links[0]);
  await waitFor(() =>
    expect(screen.queryByText('Shared channel preview')).toBeNull()
  );
  fireEvent.click(links[0]);
  expect(open).toHaveBeenCalledWith(
    'https://www.linkedin.com/in/sridiptoghosh/'
  );
  open.mockClear();
  fireEvent.click(links[0], { ctrlKey: true });
  expect(open).not.toHaveBeenCalled();
});
it('leaves other Markdown and unsafe protocols as literal text', () => {
  const text = '**hello** javascript:alert(1) data:text/html,hello';
  render(() => <SpreadsheetCellLinks value={text} />);
  expect(screen.queryByRole('link')).toBeNull();
  expect(document.body.textContent).toBe(text);
});
