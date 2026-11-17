import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal, type JSX } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedView } from '../core/saved-view';
import { SavedViewListRow } from './saved-view-list';
import { SavedViewMenuItems } from './saved-view-menu';

const press = vi.hoisted(() => ({
  hold: undefined as (() => void) | undefined,
  cancel: vi.fn(),
}));
vi.mock('@core/directive/touchHandler', () => ({
  touchHandler: (
    _element: HTMLElement,
    options: () => {
      onLongPress: () => void;
      onTouchEnd: (event: TouchEvent, held: boolean) => void;
    }
  ) => {
    press.hold = () => {
      options().onLongPress();
      options().onTouchEnd(new Event('touchend') as TouchEvent, true);
    };
    return press.cancel;
  },
}));
// Corvu's animation is not available in jsdom. Notify the row when the sheet closes.
vi.mock('@components/app/mobile/MobileDrawer', async () => {
  const { createEffect, Show } = await import('solid-js');
  const Drawer = (props: {
    open: boolean;
    onContentPresentChange: (present: boolean) => void;
    children: JSX.Element;
  }) => {
    createEffect(() => {
      if (!props.open) props.onContentPresentChange(false);
    });
    return <Show when={props.open}>{props.children}</Show>;
  };
  return {
    MobileDrawer: Object.assign(Drawer, {
      Portal: (props: { children: JSX.Element }) => props.children,
      Overlay: () => null,
      Content: (props: { children: JSX.Element; 'aria-label': string }) => (
        <div aria-label={props['aria-label']}>{props.children}</div>
      ),
      Handle: () => null,
      ScrollBody: (props: {
        children: JSX.Element;
        onClick?: JSX.EventHandler<HTMLDivElement, MouseEvent>;
        ref?: (element: HTMLDivElement) => void;
      }) => (
        <div ref={props.ref} onClick={props.onClick}>
          {props.children}
        </div>
      ),
      Section: (props: { children: JSX.Element }) => (
        <div>{props.children}</div>
      ),
      Item: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button type="button" {...props} />
      ),
    }),
  };
});
vi.stubGlobal('scrollTo', () => {});
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);

const view: SavedView = {
  id: 'view-1',
  ownerId: 'me',
  name: 'Weekly',
  config: {},
  sharedTeamId: null,
  revision: 1,
};

afterEach(() => {
  cleanup();
  press.hold = undefined;
  press.cancel.mockClear();
});

function setup(owned = true, touchInitially = true) {
  const [scope, setScope] = createSignal('me');
  const [touch, setTouch] = createSignal(touchInitially);
  const select = vi.fn();
  const edit = vi.fn();
  const duplicate = vi.fn();
  const remove = vi.fn();
  const copy = vi.fn();
  const result = render(() => (
    <SavedViewListRow
      view={view}
      selected={false}
      scopeKey={scope()}
      touchActions={touch()}
      onSelect={select}
      menu={(defer) => (
        <SavedViewMenuItems
          mobile
          owned={owned}
          onEdit={() => defer(edit)}
          onDuplicate={() => defer(duplicate)}
          onDelete={() => defer(remove)}
          onCopyLink={copy}
        />
      )}
    />
  ));
  return {
    ...result,
    setScope,
    setTouch,
    select,
    edit,
    duplicate,
    remove,
    copy,
  };
}

describe('saved view touch actions', () => {
  it('opens permission-aware actions on hold and suppresses the held tap', async () => {
    const state = setup(false);
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(state.select).toHaveBeenCalledOnce();
    state.select.mockClear();
    press.hold?.();
    expect(screen.getByRole('button', { name: 'Duplicate' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete view' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    await waitFor(() => expect(state.copy).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(state.select).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(state.select).toHaveBeenCalledOnce();
  });

  it('runs a deferred action after the sheet closes and returns focus', async () => {
    const state = setup();
    press.hold?.();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(state.edit).not.toHaveBeenCalled();
    await waitFor(() => expect(state.edit).toHaveBeenCalledOnce());
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Weekly' })
    );
  });

  it('drops deferred actions after a viewer scope change', async () => {
    const state = setup();
    press.hold?.();
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    state.setScope('other');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    );
    expect(state.duplicate).not.toHaveBeenCalled();
  });

  it('does not invoke actions from a sheet opened under a stale scope', async () => {
    const state = setup();
    press.hold?.();
    state.setScope('other');
    fireEvent.click(screen.getByRole('button', { name: 'Delete view' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Delete view' })).toBeNull()
    );
    expect(state.remove).not.toHaveBeenCalled();
  });
  it('cancels holds during scrolling and cleanup', () => {
    const state = setup();
    fireEvent.scroll(window);
    expect(press.cancel).toHaveBeenCalledOnce();
    state.unmount();
    fireEvent.scroll(window);
    expect(press.cancel).toHaveBeenCalledOnce();
  });

  it('enables hold actions when a mounted row switches to touch input', async () => {
    const state = setup(true, false);
    expect(press.hold).toBeUndefined();
    state.setTouch(true);
    press.hold?.();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(state.edit).toHaveBeenCalledOnce());

    state.setTouch(false);
    fireEvent.scroll(window);
    expect(press.cancel).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'Actions for Weekly' })
    ).toBeTruthy();
  });
  it('keeps the existing More control without touch actions', () => {
    const select = vi.fn();
    render(() => (
      <SavedViewListRow
        view={view}
        selected={false}
        scopeKey="me"
        onSelect={select}
        menu={() => (
          <SavedViewMenuItems
            owned
            onEdit={vi.fn()}
            onDuplicate={vi.fn()}
            onDelete={vi.fn()}
          />
        )}
      />
    ));
    expect(press.hold).toBeUndefined();
    expect(
      screen.getByRole('button', { name: 'Actions for Weekly' })
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Weekly' }));
    expect(select).toHaveBeenCalledOnce();
  });
});
