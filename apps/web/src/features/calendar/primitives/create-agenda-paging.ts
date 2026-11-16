import { beginInteraction } from '@app/observability/flow';
import { createSignal, onCleanup } from 'solid-js';
import { agendaDay, agendaWindowIndices } from './agenda-window';

const DAY_SELECTOR = '[data-agenda-day]';

function visibleDay(viewport: HTMLElement): HTMLElement | undefined {
  const top = viewport.getBoundingClientRect().top;
  return Array.from(viewport.querySelectorAll<HTMLElement>(DAY_SELECTOR)).find(
    (day) => day.getBoundingClientRect().bottom > top
  );
}

/** Keep a surviving day at the same viewport position while rotating five windows. */
export function createAgendaPaging(
  viewport: () => HTMLElement | undefined,
  date: Date
) {
  const [first, setFirst] = createSignal(-2);
  const [activeWindow, setActiveWindow] = createSignal(0);
  const indices = () => agendaWindowIndices(first());
  let frame: number | undefined;
  let interaction: ReturnType<typeof beginInteraction> | undefined;

  const updateActiveWindow = (element: HTMLElement) => {
    const window = visibleDay(element)?.closest<HTMLElement>(
      '[data-agenda-window]'
    );
    const index = Number(window?.dataset.agendaWindow);
    if (window && Number.isInteger(index)) setActiveWindow(index);
  };

  const positionInitial = () => {
    const element = viewport();
    if (!element) return;
    const day = Array.from(
      element.querySelectorAll<HTMLElement>(DAY_SELECTOR)
    ).find((item) => item.dataset.agendaDay === agendaDay(date).toDateString());
    if (day)
      element.scrollTop +=
        day.getBoundingClientRect().top - element.getBoundingClientRect().top;
    updateActiveWindow(element);
  };

  const move = (direction: -1 | 1) => {
    const element = viewport();
    if (!element || interaction) return;
    const day = visibleDay(element);
    if (!day) return;
    updateActiveWindow(element);
    const key = day.dataset.agendaDay;
    const top =
      day.getBoundingClientRect().top - element.getBoundingClientRect().top;
    interaction = beginInteraction('calendar.agenda.load');
    setFirst((value) => value + direction);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const match = Array.from(
        element.querySelectorAll<HTMLElement>(DAY_SELECTOR)
      ).find((item) => item.dataset.agendaDay === key);
      if (match)
        element.scrollTop +=
          match.getBoundingClientRect().top -
          element.getBoundingClientRect().top -
          top;
      interaction?.end();
      interaction = undefined;
    });
  };

  const onScroll = () => {
    const element = viewport();
    if (!element) return;
    updateActiveWindow(element);
    if (interaction) return;
    if (element.scrollTop < 320) move(-1);
    else if (
      element.scrollHeight - element.clientHeight - element.scrollTop <
      320
    )
      move(1);
  };

  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    interaction?.end();
  });

  return { indices, activeWindow, positionInitial, onScroll, move };
}
