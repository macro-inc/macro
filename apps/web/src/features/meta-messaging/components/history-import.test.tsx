import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { HistoryImportControl } from './history-import';

vi.mock('@ui', () => {
  const Box = (props: any) => <div>{props.children}</div>;
  const Dialog = Object.assign(Box, { Title: Box, Description: Box });
  const Panel = Object.assign(Box, { Header: Box, Body: Box, Footer: Box });
  return {
    Dialog,
    Panel,
    Button: (props: any) => (
      <button disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </button>
    ),
  };
});

describe('account history action', () => {
  it('requires deliberate confirmation and explains all-conversation scope', async () => {
    const onImport = vi.fn();
    render(() => (
      <HistoryImportControl
        provider="instagram"
        accountName="Test business"
        ready
        canImport
        pending={false}
        onImport={onImport}
        onRefresh={() => {}}
      />
    ));
    expect(onImport).not.toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Import history' })
    );
    expect(screen.getByText(/latest 20 messages/)).toBeTruthy();
    expect(screen.getByText(/doesn’t reopen reply windows/)).toBeTruthy();
    expect(onImport).not.toHaveBeenCalled();
    await fireEvent.click(
      screen.getByRole('button', { name: 'Import available history' })
    );
    expect(onImport).toHaveBeenCalledOnce();
  });
  it('shows a real eligibility explanation without offering an unavailable import', async () => {
    const onImport = vi.fn();
    render(() => (
      <HistoryImportControl
        provider="whatsapp"
        accountName="Test number"
        ready
        canImport={false}
        reason="Meta test numbers have no Business-app history to import."
        pending={false}
        onImport={onImport}
        onRefresh={() => {}}
      />
    ));
    await fireEvent.click(
      screen.getByRole('button', { name: 'Import history' })
    );
    expect(screen.getByText(/test numbers have no/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'Import available history' })
    ).toBeNull();
    expect(onImport).not.toHaveBeenCalled();
  });
});
