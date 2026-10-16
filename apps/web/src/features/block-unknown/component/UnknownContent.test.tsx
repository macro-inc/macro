import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { UnknownContent } from './UnknownContent';

afterEach(cleanup);

it('offers the file when there is no preview', () => {
  render(() => (
    <UnknownContent
      fileName="notes.bin"
      onShare={vi.fn()}
      onDownload={vi.fn()}
    />
  ));

  expect(screen.getByText(/No preview available for/)).toBeTruthy();
  expect(screen.queryByTestId('legacy-office-converting')).toBeNull();
  expect(screen.getByText('Download')).toBeTruthy();
});

it('says a legacy Office file is being converted and still offers the original', () => {
  const onDownload = vi.fn();
  render(() => (
    <UnknownContent
      fileName="Board Update.ppt"
      convertingTo="PowerPoint presentation"
      onShare={vi.fn()}
      onDownload={onDownload}
    />
  ));

  const status = screen.getByTestId('legacy-office-converting');
  expect(status.textContent).toContain('Board Update.ppt');
  expect(status.textContent).toContain('to a PowerPoint presentation');
  expect(screen.queryByText(/No preview available/)).toBeNull();
  screen.getByText('Download').click();
  expect(onDownload).toHaveBeenCalledOnce();
});
