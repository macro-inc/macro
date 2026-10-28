import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CrmExport } from './export-companies';

const downloadCsv = vi.hoisted(() =>
  vi.fn<(content: string, filename: string) => Promise<{ saved: boolean }>>()
);

vi.mock('@entity', () => ({ getCompanyOwnerId: () => undefined }));
vi.mock('@ui', () => {
  const Container = (props: ParentProps) => <>{props.children}</>;
  return {
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
    Dialog: Object.assign(Container, {
      Title: Container,
      Description: Container,
    }),
    Panel: Object.assign(Container, { Body: Container }),
  };
});
vi.mock('../context/crm-context', () => ({
  useCrmContext: () => ({
    downloadCsv,
    userEmail: (id: string) => id,
    createExportDefinitions: () => ({
      isPending: false,
      isSuccess: true,
      isError: false,
      data: [],
    }),
  }),
}));
vi.mock('./use-crm', () => ({
  useDealStages: () => ({
    isLoading: () => false,
    isError: () => false,
    stageDefinitionId: () => 'stage',
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([false, true])(
  'waits for the platform save result and closes only when saved=%s',
  async (saved) => {
    let finishSave!: (result: { saved: boolean }) => void;
    downloadCsv.mockImplementation(
      () => new Promise((resolve) => (finishSave = resolve))
    );
    const close = vi.fn();
    render(() => (
      <CrmExport
        kind="companies"
        currentView="Pipeline"
        onClose={close}
        onLoad={async () => ({ companies: [] })}
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Prepare export' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Download CSV' })
    );
    expect(downloadCsv).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();

    finishSave({ saved });
    await downloadCsv.mock.results[0].value;
    await waitFor(() => expect(close).toHaveBeenCalledTimes(saved ? 1 : 0));
    if (!saved) {
      expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
    }
  }
);
