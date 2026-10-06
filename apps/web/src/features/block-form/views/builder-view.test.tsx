import * as mobile from '@core/mobile/isMobile';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  type FormBookingEvent,
  type FormContext,
  FormProvider,
  type FormWriteFailure,
} from '../context/form-context';
import type { FormColumn, FormDetail } from '../core/form-model';
import { FormConditionEditor } from '../form-condition-editor';
import { createPreview } from '../primitives/create-preview';
import { createMockFormContext } from '../tests/mock-context';
import { BuilderView } from './builder-view';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});
let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.useFakeTimers();
  // jsdom's empty animation name otherwise leaves native menus waiting forever
  // for an animationend event, preventing their close-focus lifecycle.
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const columns: FormColumn[] = [
  { id: 'name', name: 'Name', kind: { type: 'text' }, options: [] },
  {
    id: 'team',
    name: 'Team',
    kind: { type: 'select', multi: false },
    options: [
      { id: 'design', label: 'Design', color: null },
      { id: 'engineering', label: 'Engineering', color: null },
    ],
  },
  { id: 'notes', name: 'Notes', kind: { type: 'text' }, options: [] },
];

/** A write the test answers by hand. */
function pending() {
  let settle: (result: Result<void, FormWriteFailure>) => void = () => {};
  const result = new ResultAsync(
    new Promise<Result<void, FormWriteFailure>>((resolve) => {
      settle = resolve;
    })
  );
  return {
    result,
    settle: (answer: Result<void, FormWriteFailure>) => settle(answer),
  };
}

function rsvp(): FormDetail {
  return {
    form: {
      id: 'form-1',
      name: 'Team survey',
      description: '',
      ownerId: 'macro|owner@example.com',
      databaseId: 'database-1',
      tableId: 'table-1',
      audience: 'members',
      status: 'open',
      closesAt: null,
      tallyVisible: false,
      confirmationMessage: '',
      submittedColumnId: null,
      respondentColumnId: null,
    },
    layout: {
      sections: [
        {
          id: 'about',
          title: 'About you',
          description: '',
          kind: 'questions',
          gateRules: null,
          gateMessage: '',
          bookingTarget: null,
          questions: [
            {
              id: 'q-name',
              columnId: 'name',
              helpText: '',
              required: true,
              widget: 'short',
            },
            {
              id: 'q-team',
              columnId: 'team',
              helpText: '',
              required: false,
              widget: 'choice',
            },
          ],
        },
      ],
    },
    columns: columns.slice(0, 2),
    access: 'owner',
    tableGone: false,
  };
}

function mount(
  options: {
    detail?: FormDetail;
    overrides?: Partial<FormContext>;
    trackWrites?: (flush: () => ResultAsync<void, FormWriteFailure>) => void;
  } = {}
) {
  const detail = options.detail ?? rsvp();
  const mock = createMockFormContext({
    detail,
    tableColumns: columns,
    overrides: options.overrides,
  });
  const rendered = render(() => (
    <FormProvider value={mock.context}>
      <BuilderView
        source={mock.source}
        detail={detail}
        collaboration={mock.shared.collaboration}
        trackWrites={options.trackWrites ?? (() => {})}
        onOpenDatabase={() => {}}
      />
    </FormProvider>
  ));
  return { ...mock, unmount: rendered.unmount };
}

describe('BuilderView', () => {
  it('keeps focus on a new section after the compact add menu closes', async () => {
    mount();
    const trigger = screen.getByRole('button', {
      name: 'Add question',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(0);
    const section = screen.getByRole('menuitem', {
      name: 'Section',
    });
    section.focus();
    fireEvent.keyDown(section, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(400);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move Section 2' })
    );
  });

  it('keeps keyboard focus in the outline when another editor changes a section', () => {
    const { shared } = mount();
    const outline = screen.getByRole('navigation', { name: 'Form outline' });
    const question = within(outline).getByRole('button', { name: 'Team' });
    question.focus();

    shared.remote((layout) => ({
      ...layout,
      sections: layout.sections.map((section) => ({
        ...section,
        title: 'Your team',
      })),
    }));

    expect(document.activeElement).toBe(question);
    expect(
      within(outline).getByRole('button', { name: 'Your team' })
    ).toBeTruthy();
    fireEvent.click(question);
    expect(
      within(screen.getByRole('group', { name: 'Question 2: Team' })).getByRole(
        'textbox',
        {
          name: 'Question',
        }
      )
    ).toBeTruthy();
  });

  it('selects an outline question on the first click while another question name saves on blur', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    mount();
    await user.click(screen.getByRole('group', { name: 'Question 1: Name' }));
    const title = screen.getByRole('textbox', {
      name: 'Question',
    });
    await user.clear(title);
    await user.type(title, 'Full name');
    const outline = screen.getByRole('navigation', { name: 'Form outline' });
    await user.click(within(outline).getByRole('button', { name: 'Team' }));

    const question = screen.getByRole('group', { name: 'Question 2: Team' });
    expect(
      within(question).getByRole<HTMLInputElement>('textbox', {
        name: 'Question',
      }).value
    ).toBe('Team');
    expect(
      within(outline)
        .getByRole('button', { name: 'Team' })
        .getAttribute('aria-current')
    ).toBe('true');
  });

  it('shows required state below a question and edits it from the footer', async () => {
    const { shared } = mount();
    const question = screen.getByRole('group', { name: 'Question 1: Name' });
    expect(within(question).getByText('Required')).toBeTruthy();
    expect(within(question).queryByText('*')).toBeNull();
    fireEvent.click(question);
    const required = within(question).getByRole('switch', { name: 'Required' });
    expect(required.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(required);
    await vi.advanceTimersByTimeAsync(0);
    expect(shared.theirs().sections[0].questions[0].required).toBe(false);
    fireEvent.click(screen.getByRole('group', { name: 'Question 2: Team' }));
    expect(within(question).queryByText('Required')).toBeNull();
  });

  it('marks the outline section receiving new questions', async () => {
    const { shared } = mount();
    const outline = screen.getByRole('navigation', { name: 'Form outline' });
    const section = within(outline).getByRole('button', { name: 'About you' });
    fireEvent.click(section);
    expect(section.getAttribute('aria-current')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Add Paragraph' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(shared.theirs().sections[0].questions.at(-1)?.widget).toBe(
      'paragraph'
    );
    expect(
      within(outline)
        .getByRole('button', { name: 'About you' })
        .getAttribute('aria-current')
    ).not.toBe('true');
  });

  it('shows the question palette beside a separate outline and adds the chosen type after the selected question', async () => {
    const { calls, shared } = mount();
    const banner = screen.getByRole('region', { name: 'Form details' });
    expect(within(banner).getByLabelText('Form name')).toBeTruthy();
    expect(within(banner).getByLabelText('Form description')).toBeTruthy();
    expect(
      within(banner).getByRole('button', { name: /Open database/ })
    ).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: 'Form outline' })
    ).toBeTruthy();
    const palette = screen.getByRole('complementary', { name: 'Add to form' });
    for (const name of [
      'Short answer',
      'Paragraph',
      'Multiple choice',
      'Checkboxes',
      'Dropdown',
      'Number',
      'Date & time',
      'Person',
      'Document',
      'Database row',
    ]) {
      expect(
        within(palette).getByRole('button', { name: `Add ${name}` })
      ).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('group', { name: 'Question 1: Name' }));
    fireEvent.click(
      within(palette).getByRole('button', { name: 'Add Paragraph' })
    );
    await vi.advanceTimersByTimeAsync(0);
    const questions = shared.theirs().sections[0].questions;
    expect(questions).toHaveLength(3);
    expect(questions[0].id).toBe('q-name');
    expect(questions[1].widget).toBe('paragraph');
    expect(questions[2].id).toBe('q-team');
    expect(calls.notices).toEqual([]);
  });

  it('adds the first question to an empty form from the palette', async () => {
    const detail = rsvp();
    detail.layout = { sections: [] };
    const { shared, calls } = mount({ detail });
    fireEvent.click(screen.getByRole('button', { name: 'Add Short answer' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(shared.theirs().sections).toHaveLength(1);
    expect(shared.theirs().sections[0].questions).toHaveLength(1);
    expect(shared.theirs().sections[0].questions[0].widget).toBe('short');
    expect(calls.notices).toEqual([]);
  });

  it('chooses a related table in a dialog from the compact add menu', async () => {
    const { shared } = mount();
    const trigger = screen.getByRole('button', {
      name: 'Add question',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    const item = screen.getByRole('menuitem', {
      name: 'Database row',
    });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(100);
    const dialog = screen.getByRole('dialog', { name: 'Choose a table' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Responses' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(shared.theirs().sections[0].questions).toHaveLength(3);
  });

  it('chooses a related table from an empty section and inserts into that section', async () => {
    const detail = rsvp();
    detail.layout.sections[0].questions = [];
    const { shared } = mount({ detail });
    const section = screen.getByRole('region', { name: 'About you' });
    const trigger = within(section).getByRole('button', {
      name: 'Add question',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(0);
    const item = screen.getByRole('menuitem', { name: 'Database row' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(100);
    const dialog = screen.getByRole('dialog', { name: 'Choose a table' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Responses' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(shared.theirs().sections[0].questions).toHaveLength(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('releases the mobile drawer pointer lock after opening it from the add menu', async () => {
    vi.spyOn(mobile, 'isMobile').mockReturnValue(true);
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      }
    );
    mount();
    const trigger = screen.getByRole('button', { name: 'Add question' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(0);
    const item = screen.getByRole('menuitem', { name: 'Database row' });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(100);
    const dialog = screen.getByRole('dialog', { name: 'Choose a table' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.body.style.pointerEvents).not.toBe('none');
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus to the compact add trigger when table selection is canceled', async () => {
    mount();
    const trigger = screen.getByRole('button', {
      name: 'Add question',
    });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(0);
    const item = screen.getByRole('menuitem', {
      name: 'Database row',
    });
    item.focus();
    fireEvent.keyDown(item, { key: 'Enter' });
    await vi.advanceTimersByTimeAsync(100);
    const dialog = screen.getByRole('dialog', { name: 'Choose a table' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await vi.advanceTimersByTimeAsync(100);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('waits for the native table picker before creating a relation question, and cancel creates nothing', async () => {
    const { shared, calls } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Add Database row' }));
    expect(screen.getByRole('dialog', { name: 'Choose a table' })).toBeTruthy();
    expect(shared.theirs().sections[0].questions).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls.layouts).toEqual([]);
    fireEvent.click(screen.getByRole('group', { name: 'Question 1: Name' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Database row' }));
    fireEvent.click(screen.getByRole('button', { name: 'Responses' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(screen.queryByRole('dialog')).toBeNull();
    const questions = shared.theirs().sections[0].questions;
    expect(questions).toHaveLength(3);
    expect(questions[0].id).toBe('q-name');
    expect(questions[2].id).toBe('q-team');
    expect(calls.notices).toEqual([]);
  });

  it('reorders a question with the keyboard and writes the shared layout once, on the drop', async () => {
    const { calls } = mount();
    const handle = screen.getByRole('button', { name: 'Move question “Name”' });
    handle.focus();
    fireEvent.keyDown(handle, { key: ' ' });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.layouts).toHaveLength(0);
    fireEvent.keyDown(handle, { key: ' ' });
    expect(calls.layouts).toHaveLength(1);
    // Focus goes back to the handle once the move rendered.
    await vi.advanceTimersByTimeAsync(0);
    expect(
      calls.layouts[0].sections[0].questions.map((question) => question.id)
    ).toEqual(['q-team', 'q-name']);
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Move question “Name”' })
    );
  });

  it('lists the column not on the form and adds it back as a question', async () => {
    const { calls } = mount();
    fireEvent.click(
      screen.getByRole('button', { name: /1 column not on this form/ })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await vi.advanceTimersByTimeAsync(400);
    expect(
      calls.layouts
        .at(-1)
        ?.sections[0].questions.map((question) => question.columnId)
    ).toEqual(['name', 'team', 'notes']);
  });

  it('removes a selected question from the form, keeping its column', async () => {
    const { calls } = mount();
    fireEvent.click(screen.getByRole('group', { name: 'Question 2: Team' }));
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Remove from form (keeps the column)',
      })
    );
    await vi.advanceTimersByTimeAsync(400);
    expect(
      calls.layouts
        .at(-1)
        ?.sections[0].questions.map((question) => question.columnId)
    ).toEqual(['name']);
    expect(
      screen.getByRole('button', { name: /2 columns not on this form/ })
    ).toBeTruthy();
  });

  it('builds a gate rule in the grid’s filter editor: the new condition stays while it is filled in, and saves once complete', async () => {
    const detail = rsvp();
    detail.layout.sections.push({
      id: 'gate',
      title: 'Eligibility',
      description: '',
      kind: 'gate',
      gateRules: { conjunction: 'and', conditions: [] },
      gateMessage: 'Not this time.',
      bookingTarget: null,
      questions: [],
    });
    const mock = createMockFormContext({ detail, tableColumns: columns });
    const context = {
      ...mock.context,
      ui: {
        ...mock.context.ui,
        renderConditionEditor: FormConditionEditor,
      },
    };
    render(() => (
      <FormProvider value={context}>
        <BuilderView
          source={mock.source}
          detail={detail}
          collaboration={mock.shared.collaboration}
          trackWrites={() => {}}
          onOpenDatabase={() => {}}
        />
      </FormProvider>
    ));
    fireEvent.click(screen.getByRole('button', { name: 'Add rule' }));
    fireEvent.click(screen.getByRole('button', { name: /Add condition/ }));
    await vi.advanceTimersByTimeAsync(1000);
    // Incomplete, so nothing is saved, and the row is still there to fill in.
    expect(mock.calls.layouts).toHaveLength(0);
    const value = screen.getByRole('textbox', { name: 'Filter value' });
    fireEvent.input(value, { target: { value: 'Ada' } });
    await vi.advanceTimersByTimeAsync(400);
    expect(mock.calls.layouts.at(-1)?.sections[1].gateRules).toEqual({
      conjunction: 'and',
      conditions: [
        {
          kind: 'condition',
          column: 'name',
          test: { kind: 'text', operator: 'contains', value: 'Ada' },
        },
      ],
    });
    expect(screen.getByRole('textbox', { name: 'Filter value' })).toBe(value);
  });

  it('offers Add question inside an empty section, where a phone can reach it', () => {
    const detail = rsvp();
    detail.layout.sections.push({
      id: 'logistics',
      title: 'Logistics',
      description: '',
      kind: 'questions',
      gateRules: null,
      gateMessage: '',
      bookingTarget: null,
      questions: [],
    });
    const mock = createMockFormContext({ detail, tableColumns: columns });
    render(() => (
      <FormProvider value={mock.context}>
        <BuilderView
          source={mock.source}
          detail={detail}
          collaboration={mock.shared.collaboration}
          trackWrites={() => {}}
          onOpenDatabase={() => {}}
        />
      </FormProvider>
    ));
    const logistics = screen.getByRole('region', { name: 'Logistics' });
    expect(
      within(logistics).getByRole('button', { name: /Add question/ })
    ).toBeTruthy();
  });

  it('accepts no edit until the shared layout opens', async () => {
    const mock = createMockFormContext({
      detail: rsvp(),
      tableColumns: columns,
    });
    mock.shared.setStatus({ kind: 'loading' });
    render(() => (
      <FormProvider value={mock.context}>
        <BuilderView
          source={mock.source}
          detail={rsvp()}
          collaboration={mock.shared.collaboration}
          trackWrites={() => {}}
          onOpenDatabase={() => {}}
        />
      </FormProvider>
    ));
    expect(
      screen
        .getByRole('status', { name: 'Loading form editor' })
        .getAttribute('aria-busy')
    ).toBe('true');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.queryByRole('group', { name: 'Question 1: Name' })
    ).toBeNull();
    mock.shared.setStatus({ kind: 'ready' });
    expect(
      screen.queryByRole('status', { name: 'Loading form editor' })
    ).toBeNull();
    expect(
      screen.getByRole('group', { name: 'Question 1: Name' })
    ).toBeTruthy();
  });

  it('says why the layout can’t be edited, keeping what it last read', () => {
    const { shared } = mount();
    shared.setStatus({
      kind: 'error',
      message: 'This form was edited by a newer version of Macro.',
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'This form was edited by a newer version of Macro.'
    );
    expect(
      screen.getByRole('group', { name: 'Question 1: Name' })
    ).toBeTruthy();
  });

  it('keeps edits made offline on screen and says they wait on this device, with no saved badge', async () => {
    const { shared } = mount();
    shared.goOffline();
    fireEvent.click(screen.getByRole('group', { name: 'Question 1: Name' }));
    fireEvent.input(screen.getByRole('textbox', { name: 'Help text' }), {
      target: { value: 'First and last' },
    });
    expect(
      screen.getByRole<HTMLInputElement>('textbox', { name: 'Help text' }).value
    ).toBe('First and last');
    expect(screen.getByRole('status').textContent).toBe(
      'You’re offline. Your changes are kept on this device and sync when you reconnect.'
    );
    expect(screen.queryByText(/Saved/)).toBeNull();
    shared.reconnect();
    expect(screen.queryByRole('status')).toBeNull();
    expect(shared.theirs().sections[0].questions[0].helpText).toBe(
      'First and last'
    );
  });

  it('says respondents still see the last valid version while the layout can’t be published', () => {
    const { shared } = mount();
    shared.setPublicationError(
      'Screener “Eligibility” checks a question asked after it.'
    );
    expect(screen.getByRole('alert').textContent).toBe(
      'Respondents still see the last valid version of this form. Screener “Eligibility” checks a question asked after it.'
    );
    shared.setPublicationError(undefined);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows another editor on the question they selected, and tells them which one this editor selected until it leaves', () => {
    const { shared, unmount } = mount();
    shared.setPeers([
      {
        peerId: 'peer-ada',
        userId: 'macro|ada@example.com',
        color: 'blue',
        selection: { sectionId: 'about', questionId: 'q-team' },
      },
    ]);
    expect(
      within(screen.getByRole('group', { name: 'Question 2: Team' })).getByText(
        'macro|ada@example.com on this question'
      )
    ).toBeTruthy();
    expect(
      within(
        screen.getByRole('group', { name: 'Question 1: Name' })
      ).queryByText(/macro\|ada/)
    ).toBeNull();
    fireEvent.click(screen.getByRole('group', { name: 'Question 1: Name' }));
    fireEvent.blur(window);
    fireEvent.focus(window);
    unmount();
    expect(shared.selections).toEqual([
      { sectionId: 'about', questionId: 'q-name' },
      undefined,
      { sectionId: 'about', questionId: 'q-name' },
      undefined,
    ]);
  });

  it('opens the preview only once a new question’s column and the form’s name landed and the layout was published', async () => {
    const creation = pending();
    const naming = pending();
    const opened: string[] = [];
    let preview: ReturnType<typeof createPreview> | undefined;
    const disposePreview = createRoot((dispose) => {
      preview = createPreview({
        reserveTab: () => ({
          show: (url) => opened.push(url),
          close: () => opened.push('closed'),
        }),
        url: () => 'preview-url',
        notify: { failure: (message) => opened.push(message) },
      });
      return dispose;
    });
    const mock = mount({
      trackWrites: (flush) => preview?.trackWrites(flush),
      overrides: {
        renameForm: () => naming.result,
        columns: () => ({
          create: () => creation.result,
          rename: () => okAsync(undefined),
          changeType: () => okAsync(undefined),
          addOptions: () => okAsync(undefined),
          updateOption: () => okAsync(undefined),
          deleteOption: () => okAsync(undefined),
          remove: () => okAsync(undefined),
          convert: () => okAsync('converted'),
        }),
      },
    });
    preview?.trackLayout(mock.shared.collaboration.flush);
    fireEvent.click(screen.getByRole('group', { name: 'Question 2: Team' }));
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate question' }));
    const name = screen.getByRole('textbox', { name: 'Form name' });
    fireEvent.input(name, { target: { value: 'Team offsite' } });
    fireEvent.blur(name);
    const opening = preview?.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toEqual([]);
    creation.settle(ok(undefined));
    await vi.advanceTimersByTimeAsync(0);
    expect(opened).toEqual([]);
    expect(mock.shared.flushes()).toBe(0);
    naming.settle(ok(undefined));
    await opening;
    expect(opened).toEqual(['preview-url']);
    expect(mock.shared.flushes()).toBe(1);
    expect(mock.shared.theirs().sections[0].questions).toHaveLength(3);
    disposePreview();
  });

  it('closes the reserved preview tab when the layout could not be published', async () => {
    const opened: string[] = [];
    let preview: ReturnType<typeof createPreview> | undefined;
    const disposePreview = createRoot((dispose) => {
      preview = createPreview({
        reserveTab: () => ({
          show: (url) => opened.push(url),
          close: () => opened.push('closed'),
        }),
        url: () => 'preview-url',
        notify: { failure: (message) => opened.push(message) },
      });
      return dispose;
    });
    const mock = mount({ trackWrites: (flush) => preview?.trackWrites(flush) });
    preview?.trackLayout(mock.shared.collaboration.flush);
    mock.shared.answerFlushes(() =>
      errAsync({ message: 'Your changes haven’t reached the server yet.' })
    );
    await preview?.open();
    expect(opened).toEqual([
      'closed',
      'The preview wasn’t opened: Your changes haven’t reached the server yet.',
    ]);
    disposePreview();
  });

  describe('the booking step', () => {
    const INTRO_CALL = { profileId: 'profile-1', eventTypeId: 'intro-call' };
    const REVIEW_CALL = { profileId: 'profile-1', eventTypeId: 'review-call' };
    const links = [
      {
        target: INTRO_CALL,
        title: 'Intro call',
        durationMinutes: 30,
        owner: 'Personal',
      },
      {
        target: REVIEW_CALL,
        title: 'Design review',
        durationMinutes: 60,
        owner: 'Personal',
      },
    ];
    const events = {
      'intro-call': {
        profile: {
          id: 'profile-1',
          name: 'Ada Lovelace',
          description: '',
          eventTypes: [],
        },
        event: {
          id: 'intro-call',
          title: 'Intro call',
          slug: 'intro',
          description: '',
          durationMinutes: 30,
          location: '',
          googleMeet: true,
          questions: [],
          requiresConfirmation: false,
          mode: 'individual' as const,
        },
      },
    };

    function mountBooking(
      detail: FormDetail,
      bookingLinks = links,
      bookingEvents: Record<string, FormBookingEvent> = events
    ) {
      const mock = createMockFormContext({
        detail,
        tableColumns: columns,
        booking: { links: bookingLinks, events: bookingEvents },
      });
      render(() => (
        <FormProvider value={mock.context}>
          <BuilderView
            source={mock.source}
            detail={detail}
            collaboration={mock.shared.collaboration}
            trackWrites={() => {}}
            onOpenDatabase={() => {}}
          />
        </FormProvider>
      ));
      return mock;
    }

    async function openMenu(name: string) {
      const trigger = screen.getByRole('button', { name });
      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'ArrowDown' });
      await vi.advanceTimersByTimeAsync(0);
    }

    async function choose(name: RegExp) {
      const item = screen.getByRole('menuitem', { name });
      item.focus();
      fireEvent.keyDown(item, { key: 'Enter' });
      await vi.advanceTimersByTimeAsync(400);
    }

    it('adds one of the editor’s booking links as the last step and saves it', async () => {
      const { calls } = mountBooking(rsvp());
      await openMenu('Booking');
      await choose(/Intro call/);
      expect(calls.layouts.at(-1)?.sections.at(-1)).toEqual({
        id: expect.any(String),
        title: 'Book a time',
        description: '',
        kind: 'booking',
        gateRules: null,
        gateMessage: '',
        bookingTarget: INTRO_CALL,
        questions: [],
      });
      const card = screen.getByRole('region', { name: 'Book a time' });
      expect(within(card).getByText('Intro call')).toBeTruthy();
      expect(within(card).getByText('30 min · Ada Lovelace')).toBeTruthy();
    });

    it('returns focus to the compact add trigger when booking selection is canceled', async () => {
      mountBooking(rsvp());
      const trigger = screen.getByRole('button', {
        name: 'Add question',
      });
      await openMenu('Add question');
      await choose(/^Booking$/);
      const dialog = screen.getByRole('dialog', {
        name: 'Choose a booking link',
      });
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it('chooses a booking link in a dialog from the compact menu and focuses its new step', async () => {
      const { shared } = mountBooking(rsvp());
      await openMenu('Add question');
      await choose(/^Booking$/);
      const dialog = screen.getByRole('dialog', {
        name: 'Choose a booking link',
      });
      expect(dialog.contains(document.activeElement)).toBe(true);
      fireEvent.click(
        within(dialog).getByRole('button', { name: /Intro call/ })
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(shared.theirs().sections.at(-1)?.bookingTarget).toEqual(
        INTRO_CALL
      );
      expect(document.activeElement).toBe(
        screen.getByRole('region', { name: 'Book a time' })
      );
    });

    it('shows each of two concurrently added booking steps with its own link, for an editor to remove one', async () => {
      const detail = rsvp();
      detail.layout.sections.push(
        {
          id: 'intro',
          title: 'Book an intro',
          description: '',
          kind: 'booking',
          gateRules: null,
          gateMessage: '',
          bookingTarget: INTRO_CALL,
          questions: [],
        },
        {
          id: 'review',
          title: 'Book a review',
          description: '',
          kind: 'booking',
          gateRules: null,
          gateMessage: '',
          bookingTarget: REVIEW_CALL,
          questions: [],
        }
      );
      mountBooking(detail, links, {
        ...events,
        'review-call': {
          profile: {
            id: 'profile-1',
            name: 'Ada Lovelace',
            description: '',
            eventTypes: [],
          },
          event: {
            id: 'review-call',
            title: 'Design review',
            slug: 'review',
            description: '',
            durationMinutes: 60,
            location: '',
            googleMeet: true,
            questions: [],
            requiresConfirmation: false,
            mode: 'individual' as const,
          },
        },
      });
      const intro = screen.getByRole('region', { name: 'Book an intro' });
      const review = screen.getByRole('region', { name: 'Book a review' });
      expect(within(intro).getByText('Intro call')).toBeTruthy();
      expect(within(intro).getByText('30 min · Ada Lovelace')).toBeTruthy();
      expect(within(review).getByText('Design review')).toBeTruthy();
      expect(within(review).getByText('60 min · Ada Lovelace')).toBeTruthy();
    });

    it('explains how to make a booking link when the editor has none', async () => {
      const { calls } = mountBooking(rsvp(), []);
      await openMenu('Booking');
      expect(screen.getByText(/You have no booking links yet/)).toBeTruthy();
      await choose(/Create a booking link/);
      expect(calls.settingsOpened).toBe(1);
      expect(calls.layouts).toHaveLength(0);
    });

    it('selects the existing booking step instead of adding a second, and changes its link', async () => {
      const detail = rsvp();
      detail.layout.sections.push({
        id: 'call',
        title: 'Book a call',
        description: '',
        kind: 'booking',
        gateRules: null,
        gateMessage: '',
        bookingTarget: INTRO_CALL,
        questions: [],
      });
      const { calls } = mountBooking(detail);
      fireEvent.click(screen.getByRole('button', { name: 'Booking' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(document.activeElement).toBe(
        screen.getByRole('region', { name: 'Book a call' })
      );
      expect(calls.layouts).toHaveLength(0);
      await openMenu('Change booking link');
      await choose(/Design review/);
      expect(calls.layouts.at(-1)?.sections.at(-1)?.bookingTarget).toEqual(
        REVIEW_CALL
      );
      expect(
        within(screen.getByRole('region', { name: 'Book a call' })).getByRole(
          'alert'
        ).textContent
      ).toContain('turned off or deleted');
    });
  });
});
