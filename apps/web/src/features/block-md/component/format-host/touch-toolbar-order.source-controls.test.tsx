/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { TouchSelectionToolbar } from '../TouchSelectionToolbar';

// Source control for the native touch toolbar RED: the real Source
// TouchSelectionToolbar with the format-host fixture's capabilities (canEdit,
// no comment capability, no user so no Task, no list so no Table, not iOS so
// no Paste, the AI flag on). Its option order is the RED's expected order.

const offsetWidth = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'offsetWidth'
);

beforeEach(() => {
  // jsdom has no layout: every option measures one width, all on one page.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get: () => 40,
  });
  vi.stubGlobal('innerWidth', 2000);
});
afterEach(() => {
  const failures: unknown[] = [];
  for (const release of [
    cleanup,
    () => {
      if (offsetWidth)
        Object.defineProperty(
          HTMLElement.prototype,
          'offsetWidth',
          offsetWidth
        );
      else Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth');
    },
    () => {
      vi.unstubAllGlobals();
    },
  ])
    try {
      release();
    } catch (error) {
      failures.push(error);
    }
  if (failures.length > 0) throw failures[0];
});

test('Source touch toolbar options for the fixture capabilities, in order', () => {
  render(() => (
    <TouchSelectionToolbar
      canEdit={true}
      canComment={false}
      hasSelection={true}
      showCreateTaskOption={false}
      createTaskLabel="Task"
      isConverting={false}
      showTableOption={false}
      showEditWithAiOption={true}
      showOpenCommentOption={false}
      locationCopied={false}
      setPopupVisible={() => {}}
      onCreateTask={() => {}}
      onConvertListToTable={() => {}}
      onOpenComment={() => {}}
      onShare={() => {}}
      onInsertComment={() => {}}
      onPaste={() => {}}
      onEditWithAi={() => {}}
    />
  ));
  // The visible page, not the hidden measuring row.
  const visible = screen
    .getAllByRole('button')
    .filter((button) => !button.closest('[aria-hidden="true"]'))
    .map((button) => button.textContent?.trim());
  expect(visible).toEqual(['Copy', 'Cut', 'Share', 'Edit with AI']);
});
