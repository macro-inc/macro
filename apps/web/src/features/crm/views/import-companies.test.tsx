import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CrmImport } from './import-companies';

vi.mock('./use-crm', () => ({
  useCompanyImporter: () => ({ create: vi.fn(), refresh: vi.fn() }),
}));

beforeEach(() => vi.stubGlobal('scrollTo', vi.fn()));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('reads the same CSV again when Change file retries a failed read', async () => {
  const user = userEvent.setup();
  const read = vi
    .fn<() => Promise<string>>()
    .mockRejectedValueOnce(new Error('File temporarily unavailable'))
    .mockResolvedValueOnce('Company,Domain\nAcme,acme.com');
  const file = new File(['Company,Domain\nAcme,acme.com'], 'companies.csv', {
    type: 'text/csv',
  });
  Object.defineProperty(file, 'text', { value: read });
  render(() => <CrmImport onClose={() => {}} onOpenPipeline={() => {}} />);

  const input = screen.getByLabelText('Companies CSV');
  const openPicker = vi.spyOn(input, 'click');
  await user.click(screen.getByRole('button', { name: 'Choose file' }));
  expect(openPicker).toHaveBeenCalledOnce();
  await user.upload(input, file);
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Could not read that file. Please try again.'
  );

  await user.click(screen.getByRole('button', { name: 'Change file' }));
  await user.upload(input, file);
  expect(await screen.findByText('acme.com')).toBeTruthy();
  expect(screen.getByText('companies.csv')).toBeTruthy();
  expect(read).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).toBeNull();
});
