import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConsentRequiredDialog } from './AdminConsentRequiredDialog';

const mocks = vi.hoisted(() => ({
  success: vi.fn(),
  failure: vi.fn(),
  writeText: vi.fn(),
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: mocks.success, failure: mocks.failure },
}));
vi.mock('@ui', () => {
  const Slot = (props: ParentProps) => <div>{props.children}</div>;
  return {
    Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props} />
    ),
    Dialog: Object.assign(Slot, { Title: Slot, Description: Slot }),
    Panel: Object.assign(Slot, { Header: Slot, Body: Slot }),
  };
});

const APPROVAL_URL =
  'https://login.microsoftonline.com/organizations/v2.0/adminconsent?client_id=app&state=signed';

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  });
  mocks.writeText.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('admin approval dialog', () => {
  it('copies the tenant-wide approval link for IT', async () => {
    render(() => (
      <AdminConsentRequiredDialog
        open
        adminConsentUrl={APPROVAL_URL}
        onConnectDifferentAccount={() => {}}
        onClose={() => {}}
      />
    ));
    expect(
      screen.getByText(
        'Your organization requires an IT admin to approve Macro before you can connect this account.'
      )
    ).toBeTruthy();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Copy admin approval link' })
    );
    await vi.waitFor(() =>
      expect(mocks.writeText).toHaveBeenCalledWith(APPROVAL_URL)
    );
    await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledOnce());
  });

  it('reports a clipboard that refuses the link', async () => {
    mocks.writeText.mockRejectedValue(new Error('denied'));
    render(() => (
      <AdminConsentRequiredDialog
        open
        adminConsentUrl={APPROVAL_URL}
        onConnectDifferentAccount={() => {}}
        onClose={() => {}}
      />
    ));
    await fireEvent.click(
      screen.getByRole('button', { name: 'Copy admin approval link' })
    );
    await vi.waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('keeps the copy action unavailable without a link and offers another account', async () => {
    const onConnectDifferentAccount = vi.fn();
    render(() => (
      <AdminConsentRequiredDialog
        open
        adminConsentUrl={undefined}
        onConnectDifferentAccount={onConnectDifferentAccount}
        onClose={() => {}}
      />
    ));
    const copy = screen.getByRole('button', {
      name: 'Copy admin approval link',
    }) as HTMLButtonElement;
    expect(copy.disabled).toBe(true);
    expect(
      screen.getByText(/The approval link is unavailable right now/)
    ).toBeTruthy();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Connect a different account' })
    );
    expect(onConnectDifferentAccount).toHaveBeenCalledOnce();
  });
});
