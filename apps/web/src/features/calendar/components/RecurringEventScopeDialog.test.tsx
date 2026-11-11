import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventRsvpScopeDialog } from './EventRsvpScopeDialog';
import { RecurringEventScopeDialog } from './RecurringEventScopeDialog';

const layout = vi.hoisted(() => ({ mobile: false }));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => layout.mobile }));

const OPTIONS = [
  { scope: 'this_event', label: 'This event' },
  { scope: 'this_and_following', label: 'This and following events' },
  { scope: 'all', label: 'All events' },
] as const;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  layout.mobile = false;
});

describe('RecurringEventScopeDialog', () => {
  it('selects a typed scope and confirms the selected value', () => {
    const onConfirm = vi.fn();
    render(() => {
      const [scope, setScope] =
        createSignal<(typeof OPTIONS)[number]['scope']>('this_event');
      return (
        <RecurringEventScopeDialog<(typeof OPTIONS)[number]['scope']>
          open
          title="Change recurring event"
          options={OPTIONS}
          scope={scope()}
          onScopeChange={setScope}
          onClose={vi.fn()}
          onConfirm={() => onConfirm(scope())}
          confirmLabel="Save changes"
        >
          <p>Extra details</p>
        </RecurringEventScopeDialog>
      );
    });

    expect(screen.getByText('Extra details')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('radio', { name: 'This and following events' })
    );
    expect(
      (
        screen.getByRole('radio', {
          name: 'This and following events',
        }) as HTMLInputElement
      ).checked
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('this_and_following');
  });

  it('cancels without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <RecurringEventScopeDialog<(typeof OPTIONS)[number]['scope']>
        open
        title="Change recurring event"
        options={OPTIONS}
        scope="this_event"
        onScopeChange={vi.fn()}
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel="Save changes"
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('dismisses on Escape without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(() => (
      <RecurringEventScopeDialog<(typeof OPTIONS)[number]['scope']>
        open
        title="Change recurring event"
        options={OPTIONS}
        scope="this_event"
        onScopeChange={vi.fn()}
        onClose={onClose}
        onConfirm={onConfirm}
        confirmLabel="Save changes"
      />
    ));

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('prevents duplicate confirmation while pending', () => {
    const onConfirm = vi.fn();
    render(() => {
      const [pending, setPending] = createSignal(false);
      return (
        <RecurringEventScopeDialog<(typeof OPTIONS)[number]['scope']>
          open
          title="Change recurring event"
          options={OPTIONS}
          scope="this_event"
          onScopeChange={vi.fn()}
          onClose={vi.fn()}
          onConfirm={() => {
            onConfirm();
            setPending(true);
          }}
          confirmLabel="Save changes"
          pending={pending()}
        />
      );
    });

    const confirm = screen.getByRole('button', { name: 'Save changes' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('keeps RSVP mobile choices and confirmation label', () => {
    layout.mobile = true;
    const onConfirm = vi.fn();
    render(() => {
      const [scope, setScope] = createSignal<'this_event' | 'all'>(
        'this_event'
      );
      return (
        <EventRsvpScopeDialog
          open
          scope={scope()}
          onScopeChange={setScope}
          onClose={vi.fn()}
          onConfirm={() => onConfirm(scope())}
        />
      );
    });

    fireEvent.click(screen.getByRole('radio', { name: 'All events' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save response' }));
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith('all');
  });
});
