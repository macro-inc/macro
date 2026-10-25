import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectorImportPromotion } from './connector-import';

const host = vi.hoisted(() => ({
  dialog: undefined as
    | undefined
    | { open: boolean; config: { action: string } },
}));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'user' }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true, loading: false }),
}));
vi.mock('@queries/prompt-dismissals', () => ({
  usePromptDismissalsQuery: () => ({
    isSuccess: true,
    isError: false,
    data: { dismissed: [] },
  }),
  dismissPromptEverywhere: vi.fn(),
}));
vi.mock('./connector-import-dialog', () => ({
  ConnectorImportDialogHost: (props: NonNullable<typeof host.dialog>) => {
    host.dialog = props;
    return <p>{props.open ? 'Dialog open' : 'Dialog closed'}</p>;
  },
}));

afterEach(() => {
  cleanup();
  host.dialog = undefined;
  localStorage.clear();
});

describe('ConnectorImportPromotion', () => {
  it('renders the card at once and loads the dialog on first open', async () => {
    render(() => <ConnectorImportPromotion category="files" applies />);
    const button = screen.getByRole('button', { name: 'Import files' });
    expect(host.dialog).toBeUndefined();
    fireEvent.click(button);
    expect(await screen.findByText('Dialog open')).toBeTruthy();
    expect(host.dialog?.config.action).toBe('Import files');
  });

  it('renders a secondary action beside the import button', () => {
    const onClick = vi.fn();
    render(() => (
      <ConnectorImportPromotion
        category="files"
        applies
        actionLabel="Import"
        secondaryAction={{ label: 'Start fresh', onClick }}
      />
    ));
    expect(screen.getByRole('button', { name: 'Import' })).toBeTruthy();
    // The dismiss label keeps naming the full import.
    expect(
      screen.getByRole('button', { name: 'Dismiss import files' })
    ).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Start fresh' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledWith(button);
    expect(host.dialog).toBeUndefined();
  });

  it('renders nothing while it does not apply', () => {
    render(() => <ConnectorImportPromotion category="files" applies={false} />);
    expect(screen.queryByRole('button', { name: 'Import files' })).toBeNull();
  });
});
