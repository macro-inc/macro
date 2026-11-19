import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedViewMenuItems } from './saved-view-menu';

vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: {
    Section: (props: { children: JSX.Element }) => (
      <section data-mobile-section>{props.children}</section>
    ),
    Item: (props: {
      children: JSX.Element;
      disabled?: boolean;
      onClick?: () => void;
    }) => (
      <button disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </button>
    ),
  },
}));
vi.mock('@ui', () => ({
  Dropdown: {
    Group: (props: { children: JSX.Element }) => (
      <section>{props.children}</section>
    ),
    Item: (props: {
      children: JSX.Element;
      disabled?: boolean;
      onSelect: () => void;
    }) => (
      <button disabled={props.disabled} onClick={props.onSelect}>
        {props.children}
      </button>
    ),
    CopyItem: (props: { children: JSX.Element; onCopy: () => void }) => (
      <button onClick={props.onCopy}>{props.children}</button>
    ),
  },
  CopyButton: (props: {
    children: JSX.Element;
    disabled?: boolean;
    onClick: () => void;
  }) => (
    <button
      data-saved-view-copy
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
}));

afterEach(cleanup);

describe('saved view menu rendering', () => {
  it('keeps Copy before Modify and Delete on desktop', () => {
    const onCopyLink = vi.fn();
    const onEdit = vi.fn();
    render(() => (
      <SavedViewMenuItems
        owned
        appearance={<button>Appearance</button>}
        onCopyLink={onCopyLink}
        onEdit={onEdit}
        onDuplicate={vi.fn()}
        onDelete={vi.fn()}
      />
    ));

    expect(
      [...document.querySelectorAll('section')].map((section) =>
        [...section.querySelectorAll('button')].map(
          (button) => button.textContent
        )
      )
    ).toEqual([
      ['entityActions.copyLinkCommand'],
      ['viewMenus.editView', 'Appearance', 'viewMenus.duplicate'],
      ['viewMenus.deleteView'],
    ]);
    fireEvent.click(screen.getByText('entityActions.copyLinkCommand'));
    fireEvent.click(screen.getByText('viewMenus.editView'));
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders touch sections and custom labels with a copy action', () => {
    const onCopyLink = vi.fn();
    const onMoveDown = vi.fn();
    render(() => (
      <SavedViewMenuItems
        mobile
        owned
        editLabel="Rename"
        deleteLabel="Remove"
        appearance={<button>Appearance</button>}
        onCopyLink={onCopyLink}
        onEdit={vi.fn()}
        onDuplicate={vi.fn()}
        onMoveDown={onMoveDown}
        onDelete={vi.fn()}
      />
    ));

    expect(
      [...document.querySelectorAll('[data-mobile-section]')].map((section) =>
        [...section.querySelectorAll('button')].map(
          (button) => button.textContent
        )
      )
    ).toEqual([
      ['entityActions.copyLinkCommand'],
      ['Rename', 'Appearance', 'viewMenus.duplicate', 'viewMenus.moveDown'],
      ['Remove'],
    ]);
    fireEvent.click(screen.getByText('entityActions.copyLinkCommand'));
    fireEvent.click(screen.getByText('viewMenus.moveDown'));
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onMoveDown).toHaveBeenCalledOnce();
    expect(
      screen
        .getByText('entityActions.copyLinkCommand')
        .hasAttribute('data-saved-view-copy')
    ).toBe(true);
  });
});
