import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCalendarEventFormController } from '@app/features/calendar/components/composer/create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '@app/features/calendar/components/composer/event-form-model';
import { ComposerRoot } from '@app/features/calendar/components/composer/root/ComposerRoot';
import { CalendarComposerHostContext } from '@app/features/calendar/context/calendar-composer-host-context';
import { createCalendarComposer } from '@app/features/calendar/primitives/create-calendar-composer';
import { createCalendarComposerSession } from '@app/features/calendar/primitives/create-calendar-composer-session';
import { DEFAULT_GUEST_POLICY } from '@app/features/calendar/types';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { compile, optimize } from '@tailwindcss/node';
import postcss from 'postcss';
import { type JSX, Show } from 'solid-js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CalendarComposerSurface } from './CalendarComposerSurface';

// Keep the production Popover.Content and placement DOM. Only the data-backed
// form body is replaced; the bug concerns the element painting its outer edge.
vi.mock('@app/features/calendar/views/composer/StandaloneComposer', () => ({
  StandaloneComposer: () => {
    const controller = createCalendarEventFormController({
      initialValue: defaultEditorInitialValues(
        new Date('2030-01-01T09:00'),
        false
      ),
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    const model = createCalendarComposer({
      controller,
      pending: false,
      onSubmit: vi.fn(),
    });
    return (
      <div class="flex h-full min-h-0 flex-col text-ink">
        <ComposerRoot model={model} class="min-h-0 flex-1" />
      </div>
    );
  },
}));
vi.mock('@core/component/ScopedPortal', () => ({
  ScopedPortal: (props: { children: JSX.Element }) => props.children,
}));

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  );
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme-light');
});

it.each(['create', 'edit'])(
  'paints the real %s card above glass and its children',
  async (mode) => {
    document.documentElement.setAttribute('data-theme-light', 'false');
    let open = async () => {};
    let pin = () => {};
    render(() => {
      const sessions = createCalendarComposerSession({
        confirmDiscard: async () => true,
      });
      open = async () => {
        const key = await sessions.open({
          event:
            mode === 'edit'
              ? {
                  id: 'event',
                  eventId: 'event',
                  occurrenceKey: '2030-01-01',
                  isCancelled: false,
                  isReadOnly: false,
                  guestPolicy: DEFAULT_GUEST_POLICY,
                  viewerCan: {
                    editDetails: true,
                    inviteGuests: true,
                    removeGuests: true,
                    setGuestPolicy: true,
                    rsvp: false,
                    organize: true,
                  },
                  attendees: [],
                  recurrenceLines: [],
                  title: 'Review',
                  start: '2030-01-01T09:00:00Z',
                  end: '2030-01-01T10:00:00Z',
                  allDay: false,
                  sourceCalendarIds: ['calendar'],
                  calendarId: 'calendar',
                  calendar: { id: 'calendar', name: 'Calendar', color: '' },
                  visibleCalendars: [],
                }
              : undefined,
        });
        if (key === undefined) throw new Error('Expected composer session');
        pin = () => sessions.setPinned(key, true);
      };
      return (
        <CalendarComposerHostContext.Provider
          value={{
            sessions,
            canPinComposer: () => true,
            composerPinned: () => sessions.state.pinned,
            boundary: () => undefined,
            dock: () => undefined,
            setDock: () => {},
            drag: () => undefined,
            setDrag: () => {},
            cardPinned: () => false,
            setCardPinned: () => {},
            leftPanelPinned: () => sessions.state.pinned,
            open: sessions.open,
          }}
        >
          <Show when={sessions.state.session}>
            {(session) => <CalendarComposerSurface session={session()} />}
          </Show>
        </CalendarComposerHostContext.Provider>
      );
    });
    await open();
    const surface = screen.getByRole('dialog');
    const base = resolve('src');
    const shared = await compile(
      await readFile(resolve(base, 'index.css'), 'utf8'),
      {
        base,
        onDependency: () => {},
      }
    );
    const sharedCss = postcss.parse(
      optimize(shared.build([...surface.classList])).code
    );
    const borderValues: string[] = [];
    sharedCss.walkDecls('--border-secondary', (declaration) => {
      borderValues.push(declaration.value);
    });
    expect(borderValues).toContain('oklch(100% 0 0 / .12)');
    expect(borderValues).toContain('oklch(0% 0 0 / .12)');
    const featureBase = resolve(
      base,
      'features/calendar/components/composer/root'
    );
    const feature = await compile(
      await readFile(resolve(featureBase, 'composer-surface.css'), 'utf8'),
      {
        base: featureBase,
        onDependency: () => {},
      }
    );
    const featureCss = postcss.parse(optimize(feature.build([])).code);

    // jsdom cannot match nested :has inside :is. Expand this equivalent selector
    // list, while retaining the production rule and its theme condition.
    const matches = (selector: string) =>
      surface.matches(
        selector.replace(
          /^:is\((.+)\)(:where\(.+\))$/,
          (_, list: string, condition: string) =>
            list
              .split(', ')
              .map((part) => `${part}${condition}`)
              .join(', ')
        )
      );
    const verifyEdge = () => {
      let foundOutline = false;
      featureCss.walkRules((rule) => {
        if (!matches(rule.selector)) return;
        expect(rule.parent?.type).toBe('root');
        expect(rule.nodes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              prop: 'outline',
              value: '1px solid var(--border-secondary)',
            }),
            expect.objectContaining({ prop: 'outline-offset', value: '-1px' }),
          ])
        );
        foundOutline = true;
      });
      expect(foundOutline).toBe(true);
      const currentClasses = postcss.parse(
        optimize(shared.build([...surface.classList])).code
      );
      currentClasses.walkDecls(/^outline/, (declaration) => {
        // Normal utility-layer outlines cannot defeat the unlayered card edge.
        expect(declaration.important).toBeFalsy();
      });
      document.documentElement.setAttribute('data-theme-light', 'true');
      featureCss.walkRules((rule) =>
        expect(matches(rule.selector)).toBe(false)
      );
      document.documentElement.setAttribute('data-theme-light', 'false');
    };
    verifyEdge();
    pin();
    expect(screen.getByRole('dialog')).toBe(surface);
    verifyEdge();
  }
);
