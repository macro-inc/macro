import { cleanup, render, screen, waitFor } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarComposer } from '../../../primitives/create-calendar-composer';
import { createCalendarEventFormController } from '../create-calendar-event-form-controller';
import { defaultEditorInitialValues } from '../event-form-model';
import { ComposerRoot } from '../root/ComposerRoot';
import { ComposerDescription } from './ComposerDescription';

vi.mock('@core/component/LexicalMarkdown/component/menu/MentionsMenu', () => ({
  MentionsMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/EmojiMenu', () => ({
  EmojiMenu: () => null,
}));
vi.mock('@core/component/LexicalMarkdown/component/menu/SnippetsMenu', () => ({
  SnippetsMenu: () => null,
}));

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class ResizeObserverStub {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe() {
    queueMicrotask(() => this.callback([], this));
  }
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  vi.stubGlobal('scrollTo', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mountDescription() {
  const mounted: {
    controller?: ReturnType<typeof createCalendarEventFormController>;
  } = {};
  render(() => {
    const controller = createCalendarEventFormController({
      initialValue: {
        ...defaultEditorInitialValues(new Date('2030-01-01T09:00:00'), false),
        title: 'Planning',
        description: 'Original notes',
      },
      calendarOptions: () => [],
      guestOptions: () => [],
    });
    mounted.controller = controller;
    const model = createCalendarComposer({
      controller,
      pending: false,
      onSubmit: vi.fn(),
    });
    return (
      <ComposerRoot model={model}>
        <ComposerDescription />
      </ComposerRoot>
    );
  });
  if (!mounted.controller) throw new Error('Controller did not mount');
  return mounted.controller;
}

it('displays an external description seed and keeps it when the user continues typing', async () => {
  const controller = mountDescription();
  await screen.findByLabelText('Description');
  controller.replaceFromExternal({
    ...controller.state(),
    description: 'Suggested notes',
  });
  await waitFor(() =>
    expect(screen.getByLabelText('Description').textContent).toBe(
      'Suggested notes'
    )
  );
  await userEvent.click(screen.getByLabelText('Description'));
  await userEvent.keyboard(' and details');
  await waitFor(() => {
    expect(controller.state().description).toContain('Suggested notes');
    expect(controller.state().description).toContain('details');
  });
});

it('keeps the same editable node during ordinary typing', async () => {
  const controller = mountDescription();
  const field = await screen.findByLabelText('Description');
  await userEvent.click(field);
  await userEvent.keyboard(' and details');
  await waitFor(() =>
    expect(controller.state().description).toContain('details')
  );
  expect(screen.getByLabelText('Description')).toBe(field);
});
