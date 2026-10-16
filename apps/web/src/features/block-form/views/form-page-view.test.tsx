import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { FormTab } from '../components/form-tabs';
import { FormProvider, type FormWriteFailure } from '../context/form-context';
import type { FormDetail } from '../core/form-model';
import { createPreview, type Preview } from '../primitives/create-preview';
import { createMockFormContext } from '../tests/mock-context';
import { FormPageView } from './form-page-view';

beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});
let animationStyle: HTMLStyleElement;
beforeEach(() => {
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
});

const detail: FormDetail = {
  form: {
    id: 'form-1',
    name: 'Workshop registration',
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
        questions: [],
      },
    ],
  },
  columns: [],
  access: 'owner',
  tableGone: false,
};

describe('form editor preview', () => {
  it('waits for a confirmation message saved on blur before opening Preview from Settings', async () => {
    const user = userEvent.setup();
    let finishSave!: (result: Result<void, FormWriteFailure>) => void;
    const saving = new ResultAsync(
      new Promise<Result<void, FormWriteFailure>>((resolve) => {
        finishSave = resolve;
      })
    );
    const changes: string[] = [];
    const mock = createMockFormContext({
      detail,
      overrides: {
        updateMetadata: (_, patch) => {
          changes.push(patch.confirmationMessage ?? '');
          return saving;
        },
      },
    });
    const [tab, setTab] = createSignal<FormTab>('share');
    const opened: string[] = [];
    let opening: Promise<void> | undefined;
    render(() => {
      const preview = createPreview({
        reserveTab: () => ({
          show: (url) => opened.push(url),
          close: () => {},
        }),
        url: () => 'preview-url',
        notify: mock.context.notify,
      });
      return (
        <FormProvider value={mock.context}>
          <button
            onClick={() => {
              opening = preview.open();
            }}
          >
            Preview
          </button>
          <FormPageView
            source={mock.source}
            tab={tab()}
            preview={preview}
            respondLink="respond-url"
            onTabChange={setTab}
            onOpenDatabase={() => {}}
            onOpenShare={() => {}}
            onTrashed={() => {}}
          />
        </FormProvider>
      );
    });
    await user.type(
      screen.getByRole('textbox', { name: 'Confirmation message' }),
      'See you at the workshop'
    );
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(changes).toEqual(['See you at the workshop']);
    expect(opened).toEqual([]);
    expect(mock.shared.flushes()).toBe(0);

    finishSave(ok(undefined));
    await opening;
    expect(opened).toEqual(['preview-url']);
    expect(mock.shared.flushes()).toBe(1);
  });

  it('keeps pending question creation alive after leaving Build and publishes it before Preview opens', async () => {
    const user = userEvent.setup();
    let finishCreate!: (result: Result<void, FormWriteFailure>) => void;
    const creating = new ResultAsync(
      new Promise<Result<void, FormWriteFailure>>((resolve) => {
        finishCreate = resolve;
      })
    );
    const mock = createMockFormContext({
      detail,
      overrides: {
        columns: () => ({
          create: () => creating,
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
    const [tab, setTab] = createSignal<FormTab>('build');
    const opened: string[] = [];
    let preview!: Preview;
    let opening: Promise<void> | undefined;
    render(() => {
      preview = createPreview({
        reserveTab: () => ({
          show: (url) => opened.push(url),
          close: () => {},
        }),
        url: () => 'preview-url',
        notify: mock.context.notify,
      });
      return (
        <FormProvider value={mock.context}>
          <button
            onClick={() => {
              opening = preview.open();
            }}
          >
            Preview
          </button>
          <FormPageView
            source={mock.source}
            tab={tab()}
            preview={preview}
            respondLink="respond-url"
            onTabChange={setTab}
            onOpenDatabase={() => {}}
            onOpenShare={() => {}}
            onTrashed={() => {}}
          />
        </FormProvider>
      );
    });
    await user.click(
      screen.getAllByRole('button', { name: 'Add question' }).at(-1)!
    );
    await user.click(screen.getByRole('menuitem', { name: 'Short answer' }));
    await user.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(mock.shared.selections.at(-1)).toBeUndefined();
    await user.click(screen.getByRole('button', { name: 'Preview' }));
    expect(preview.opening()).toBe(true);
    expect(opened).toEqual([]);

    finishCreate(ok(undefined));
    await opening;
    expect(mock.shared.theirs().sections[0].questions).toHaveLength(1);
    expect(opened).toEqual(['preview-url']);
    expect(mock.shared.flushes()).toBe(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Build' }));
    expect(mock.shared.selections.at(-1)?.questionId).toBeTruthy();
  });
});
