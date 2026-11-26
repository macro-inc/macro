import { triggerFocusInput } from '@core/directive/focusInput';
import { createElementSize } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import { useCalendarComposer } from '../../../context/calendar-composer-context';
import { PhoneComposerMenuContext } from '../../../context/phone-composer-menu-context';
import {
  PHONE_MENU_IDS,
  type PhoneMenuId,
  phoneMenuPattern,
} from '../../../primitives/phone-menu-pattern';

export function PhoneComposerMenuRoot(
  props: ParentProps<{ scrollElement: Accessor<HTMLElement | undefined> }>
) {
  const model = useCalendarComposer();
  const when = model.when;
  const [root, setRoot] = createSignal<HTMLElement>();
  const [mount, setMount] = createSignal<HTMLElement>();
  const size = createElementSize(root);
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  const labelsFit = createMemo(() => {
    const calendars = model.controller.calendarOptions();
    const element = root();
    if (measure && element)
      measure.font = `16px ${getComputedStyle(element).fontFamily}`;
    return Boolean(
      measure &&
        size.width &&
        calendars.every(
          (calendar) =>
            measure.measureText(calendar.label).width <= (size.width ?? 0) - 96
        )
    );
  });
  const permitted = (active: string | undefined) => {
    const fields = [
      ['call', 'conference'],
      ['calendar', 'calendar'],
      ['reminders', 'reminders'],
      ['repeat', 'recurrence'],
      ['custom-repeat', 'recurrence'],
      ['people', 'guests'],
      ['decline', 'outOfOffice'],
    ] as const;
    const key = fields.find(([menu]) => menu === active)?.[1];
    if (key && model.fieldIsDisabled(key)) return false;
    if (active === 'visibility') return !model.visibilityIsDisabled();
    if (active === 'time-zone') return !model.timeZoneIsDisabled();
    return true;
  };
  const pattern = (menu: PhoneMenuId) =>
    phoneMenuPattern(menu, {
      count: model.controller.calendarOptions().length,
      labelsFit: labelsFit(),
    });
  const page = () => {
    const active = PHONE_MENU_IDS.find((menu) => menu === when.state.active);
    return (
      active !== undefined && permitted(active) && pattern(active) === 'page'
    );
  };
  let trigger: HTMLButtonElement | undefined;
  let savedScroll = 0;
  let frame: number | undefined;
  const close = () => {
    when.close();
    trigger?.focus({ preventScroll: true });
  };
  createEffect(on(model.controller.detailsRevision, close, { defer: true }));
  createEffect(
    on(
      () => (page() ? when.state.active : undefined),
      (open, previous) => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const scroll = props.scrollElement();
          if (scroll) scroll.scrollTop = open ? 0 : savedScroll;
          if (!open && previous) trigger?.focus({ preventScroll: true });
        });
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  const open = (menu: PhoneMenuId, button: HTMLButtonElement) => {
    if (when.state.active === menu) {
      close();
      return;
    }
    if (!page()) savedScroll = props.scrollElement()?.scrollTop ?? 0;
    trigger = button;
    when.open(menu);
    if (menu === 'time-zone' || menu === 'people')
      triggerFocusInput(
        () => mount()?.querySelector<HTMLInputElement>('input'),
        button
      );
  };
  const handleEscape = (event: KeyboardEvent) => {
    if (
      event.key !== 'Escape' ||
      !PHONE_MENU_IDS.some((menu) => menu === when.state.active)
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (when.state.active === 'custom-repeat') when.open('repeat');
    else close();
  };
  return (
    <PhoneComposerMenuContext.Provider
      value={{ when, pattern, page, mount, open, close }}
    >
      <div
        ref={setRoot}
        class="relative min-h-0 min-w-0"
        on:keydown={handleEscape}
      >
        {props.children}
        <div
          ref={setMount}
          hidden={!page()}
          class="min-h-0 min-w-0"
          data-phone-menu-page=""
        />
      </div>
    </PhoneComposerMenuContext.Provider>
  );
}
