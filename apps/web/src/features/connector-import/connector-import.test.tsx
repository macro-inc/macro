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

  it('renders nothing while it does not apply', () => {
    render(() => <ConnectorImportPromotion category="files" applies={false} />);
    expect(screen.queryByRole('button', { name: 'Import files' })).toBeNull();
  });
});
