import { cleanup, render, screen } from '@solidjs/testing-library';
import {
  type Component,
  createMemo,
  createRoot,
  createSignal,
  getOwner,
  lazy,
  Suspense,
} from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { ImperativeDialogHost, openDialog } from './ImperativeDialog';

afterEach(cleanup);

describe('keyed imperative dialogs', () => {
  it('reuses simultaneous openers and permits reopening after dismissal', async () => {
    render(() => <ImperativeDialogHost />);
    const Dialog = () => <div role="dialog">Share</div>;
    const first = openDialog(Dialog, {}, { key: 'share:document:one' });
    const duplicate = openDialog(Dialog, {}, { key: 'share:document:one' });
    expect(duplicate).toBe(first);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    first.close();
    expect(await duplicate.closed).toEqual({
      id: first.id,
      reason: 'programmatic',
    });
    const reopened = openDialog(Dialog, {}, { key: 'share:document:one' });
    expect(reopened.id).not.toBe(first.id);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('closes a reused dialog when its original component is disposed', async () => {
    render(() => <ImperativeDialogHost />);
    const Dialog = () => <div role="dialog">Share</div>;
    const { handle, dispose } = createRoot((dispose) => ({
      handle: openDialog(
        Dialog,
        {},
        { owner: getOwner(), key: 'share:document:two' }
      ),
      dispose,
    }));
    expect(openDialog(Dialog, {}, { key: 'share:document:two' })).toBe(handle);
    dispose();
    expect(await handle.closed).toEqual({
      id: handle.id,
      reason: 'owner-disposed',
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps the app mounted while a lazy dialog loads', async () => {
    const pending = Promise.withResolvers<{ default: Component }>();
    const LazyDialog = lazy(() => pending.promise);
    render(() => (
      <Suspense fallback={<div>App loading</div>}>
        <main>App content</main>
        <ImperativeDialogHost />
      </Suspense>
    ));
    const app = screen.getByRole('main');
    openDialog(LazyDialog, {});
    await Promise.resolve();

    expect(app.isConnected).toBe(true);
    expect(screen.queryByText('App loading')).toBeNull();

    pending.resolve({ default: () => <div role="dialog">Loaded dialog</div> });
    expect((await screen.findByRole('dialog')).textContent).toBe(
      'Loaded dialog'
    );
    expect(screen.getByRole('main')).toBe(app);
  });
  it('closes dialogs when a memo owner reruns without changing identity', async () => {
    render(() => <ImperativeDialogHost />);
    const Dialog = () => <div role="dialog">Section</div>;
    const { owner, setSections, dispose } = createRoot((dispose) => {
      const [sections, setSections] = createSignal(true);
      const owner = createMemo(() => {
        sections();
        return getOwner();
      });
      return { owner, setSections, dispose };
    });
    try {
      const initialOwner = owner();
      const first = openDialog(Dialog, {}, { owner: initialOwner });
      setSections(false);
      expect(first.isOpen()).toBe(false);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(owner()).toBe(initialOwner);
      expect(await first.closed).toEqual({
        id: first.id,
        reason: 'owner-disposed',
      });

      const second = openDialog(Dialog, {}, { owner: owner() });
      setSections(true);
      expect(second.isOpen()).toBe(false);
      expect(await second.closed).toEqual({
        id: second.id,
        reason: 'owner-disposed',
      });
      expect(screen.queryByRole('dialog')).toBeNull();
    } finally {
      dispose();
    }
  });
});
