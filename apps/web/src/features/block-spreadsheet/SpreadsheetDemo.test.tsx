import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import type { JSX, ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpreadsheetStore } from './primitives/create-spreadsheet-store';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  save: vi.fn(),
  chat: vi.fn(),
  replace: vi.fn(),
  failure: vi.fn(),
  download: vi.fn(),
  menuTrigger: vi.fn(),
  menuActions: vi.fn(),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: { replace: mocks.replace },
    setTitleFileMenuTrigger: mocks.menuTrigger,
    setTitleFileMenuActions: mocks.menuActions,
  }),
}));
vi.mock('@components/app/split-layout/components/SplitHeader', () => ({
  SplitHeaderLeft: (props: ParentProps) => props.children,
  SplitHeaderRight: (props: ParentProps) => props.children,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  StaticSplitLabel: (props: { label: string }) => <span>{props.label}</span>,
  SplitTitleFileMenu: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@app/features/chat/ChatWithAgentButton', () => ({
  ChatWithAgentIcon: () => null,
  openChatWithAgent: mocks.chat,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { failure: mocks.failure },
}));
vi.mock('@filesystem/download', () => ({ downloadFile: mocks.download }));
vi.mock('./queries/create-spreadsheet', () => ({
  createSpreadsheetDocument: mocks.create,
}));
vi.mock('./queries/save-spreadsheet-draft', () => ({
  saveSpreadsheetDraft: mocks.save,
}));
vi.mock('@ui', async () => ({
  Dialog: (await import('@ui/components/Dialog')).Dialog,
  Dropdown: (await import('@ui/components/Dropdown')).Dropdown,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      aria-busy={props['aria-busy']}
    >
      {props.children}
    </button>
  ),
}));
vi.mock('./views/SpreadsheetEditor', () => ({
  SpreadsheetEditor: (props: {
    store: SpreadsheetStore;
    onExport: (content: string) => void;
  }) => (
    <>
      <button
        type="button"
        disabled={!props.store.canEdit()}
        onClick={() => props.store.setSelection({ anchor: 'E9', focus: 'B4' })}
      >
        Select budget
      </button>
      <button type="button" onClick={() => props.onExport('Budget')}>
        Export CSV
      </button>
    </>
  ),
}));

import SpreadsheetDemo from './SpreadsheetDemo';

let animationStyle: HTMLStyleElement;
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
  mocks.create.mockResolvedValue('saved-spreadsheet');
  mocks.save.mockResolvedValue(undefined);
  mocks.chat.mockResolvedValue(true);
});

describe('Ask Macro in the spreadsheet demo', () => {
  it('shows Ask Macro before Share, attaches the current selection, and replaces the saved draft', async () => {
    render(() => <SpreadsheetDemo />);
    const buttons = screen.getAllByRole('button');
    expect(
      buttons.indexOf(screen.getByRole('button', { name: 'Ask Macro' }))
    ).toBeLessThan(
      buttons.indexOf(screen.getByRole('button', { name: 'Share' }))
    );
    fireEvent.click(screen.getByRole('button', { name: 'Select budget' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ask Macro' }));
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledOnce());
    expect(mocks.chat).toHaveBeenCalledWith({
      type: 'document',
      id: 'saved-spreadsheet',
      name: 'Launch budget',
      fileType: 'spreadsheet',
      blockParams: { sheetId: 'sheet1', sheetName: 'Sheet1', range: 'B4:E9' },
    });
    expect(mocks.save).toHaveBeenCalledWith(
      'saved-spreadsheet',
      expect.any(Uint8Array)
    );
    expect(mocks.replace).toHaveBeenCalledWith({
      next: { type: 'spreadsheet', id: 'saved-spreadsheet' },
      mergeHistory: true,
      referredFrom: 'entity-actions-menu',
    });
  });

  it('keeps editing available after save failure and never opens an unattached chat', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Offline'));
    render(() => <SpreadsheetDemo />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Macro' }));
    await waitFor(() => expect(mocks.failure).toHaveBeenCalledOnce());
    expect(mocks.chat).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(
      screen
        .getByRole('button', { name: 'Select budget' })
        .hasAttribute('disabled')
    ).toBe(false);
    expect(
      screen.getByRole('button', { name: 'Ask Macro' }).hasAttribute('disabled')
    ).toBe(false);
  });
});

describe('Spreadsheet draft title menu', () => {
  it('registers title actions and removes them when the draft closes', () => {
    const view = render(() => <SpreadsheetDemo />);
    expect(mocks.menuTrigger).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.menuActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        macro: [expect.objectContaining({ label: 'Ask Macro' })],
        sharing: [expect.objectContaining({ label: 'Share' })],
        file: [expect.objectContaining({ label: 'Rename' })],
      })
    );
    view.unmount();
    expect(mocks.menuTrigger).toHaveBeenLastCalledWith(undefined);
    expect(mocks.menuActions).toHaveBeenLastCalledWith(undefined);
  });

  it('renames the title, exported file, saved document, and chat attachment together', async () => {
    render(() => <SpreadsheetDemo />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'File actions' }), {
      key: 'Enter',
    });
    expect(
      screen.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Ask Macro', 'Share', 'Rename']);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Rename' }), {
      key: 'Enter',
    });
    const input = await screen.findByRole('textbox', {
      name: 'Spreadsheet name',
    });
    fireEvent.input(input, { target: { value: '  Quarterly plan  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save name' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('Quarterly plan')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(mocks.download).toHaveBeenCalledWith(
      expect.any(Blob),
      'Quarterly plan.csv'
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'File actions' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Ask Macro' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(mocks.chat).toHaveBeenCalledOnce());
    expect(mocks.create).toHaveBeenCalledWith({
      title: 'Quarterly plan',
      source: 'spreadsheet-demo',
    });
    expect(mocks.chat).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Quarterly plan' })
    );
  });

  it('saves from the draft title menu and opens document sharing', async () => {
    render(() => <SpreadsheetDemo />);
    fireEvent.keyDown(screen.getByRole('button', { name: 'File actions' }), {
      key: 'Enter',
    });
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Share' }), {
      key: 'Enter',
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());
    expect(mocks.replace).toHaveBeenCalledWith({
      next: {
        type: 'spreadsheet',
        id: 'saved-spreadsheet',
        params: { share: 'true' },
      },
      mergeHistory: true,
      referredFrom: 'entity-actions-menu',
    });
  });
});
