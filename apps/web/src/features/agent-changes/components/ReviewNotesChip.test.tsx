import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewNote } from '../core/review-notes';
import { ReviewNotesChip } from './ReviewNotesChip';

function note(overrides: Partial<ReviewNote> = {}): ReviewNote {
  return {
    id: 'n1',
    path: 'apps/web/src/a.ts',
    side: 'additions',
    lineNumber: 2,
    endLineNumber: 2,
    text: 'Use a constant',
    createdAt: '2026-09-15T00:00:00Z',
    ...overrides,
  };
}

describe('ReviewNotesChip', () => {
  it('hides note text until expanded, then lets the reviewer edit', () => {
    const [notes, setNotes] = createSignal([
      note(),
      note({
        id: 'n2',
        path: 'crates/x/src/lib.rs',
        lineNumber: 1,
        endLineNumber: 1,
        text: 'Name this',
      }),
    ]);
    const [expanded, setExpanded] = createSignal(false);
    const onUpdate = vi.fn((id: string, text: string) => {
      setNotes((current) =>
        current.map((item) => (item.id === id ? { ...item, text } : item))
      );
    });
    const onSend = vi.fn();
    render(() => (
      <ReviewNotesChip
        notes={notes()}
        expanded={expanded()}
        onToggleExpanded={() => setExpanded((open) => !open)}
        onUpdate={onUpdate}
        onRemove={() => {}}
        onSend={onSend}
      />
    ));

    expect(screen.getByText(/review notes/).textContent).toContain('2');
    expect(screen.queryByLabelText(/Review note on/)).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: /2 review notes queued/ })
    );
    expect(
      screen
        .getByRole('button', { name: /2 review notes queued/ })
        .getAttribute('aria-expanded')
    ).toBe('true');

    const first = screen.getByLabelText(
      'Review note on apps/web/src/a.ts, line 2 (new)'
    ) as HTMLTextAreaElement;
    expect(first.value).toBe('Use a constant');
    expect(
      screen.getByLabelText('Review note on crates/x/src/lib.rs, line 1 (new)')
    ).toBeTruthy();

    fireEvent.input(first, { target: { value: 'Use a named constant' } });
    expect(onUpdate).toHaveBeenCalledWith('n1', 'Use a named constant');

    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('does not send when every note is empty', () => {
    const onSend = vi.fn();
    render(() => (
      <ReviewNotesChip
        notes={[note({ text: '   ' })]}
        expanded
        onToggleExpanded={() => {}}
        onUpdate={() => {}}
        onRemove={() => {}}
        onSend={onSend}
      />
    ));
    expect(
      (
        screen.getByRole('button', {
          name: 'Send to agent',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));
    expect(onSend).not.toHaveBeenCalled();
  });
});
