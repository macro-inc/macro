import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SpreadsheetGoalSeekDialog } from './SpreadsheetGoalSeekDialog';

vi.mock('@ui/components/Tooltip', () => ({
  Tooltip: (props: ParentProps) => props.children,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@components/app/mobile/MobileDrawer', () => ({
  MobileDrawer: () => null,
}));

let animationStyle: HTMLStyleElement;
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  animationStyle = document.createElement('style');
  animationStyle.textContent = '* { animation-name: none !important; }';
  document.head.append(animationStyle);
});
afterEach(() => {
  cleanup();
  animationStyle.remove();
  vi.restoreAllMocks();
});

describe('Goal Seek dialog', () => {
  it('collects the formula, goal, and changing cell, then confirms the solution', () => {
    const onSeek = vi.fn();
    const onApply = vi.fn();
    const onSetCell = vi.fn();
    const onGoal = vi.fn();
    const onChangingCell = vi.fn();
    render(() => (
      <SpreadsheetGoalSeekDialog
        open
        onClose={() => {}}
        setCell="B1"
        onSetCell={onSetCell}
        goal=""
        onGoal={onGoal}
        changingCell="A1"
        onChangingCell={onChangingCell}
        seeking={false}
        solution={undefined}
        message=""
        onSeek={onSeek}
        onApply={onApply}
        onEdit={() => {}}
      />
    ));
    fireEvent.input(screen.getByRole('textbox', { name: 'To value' }), {
      target: { value: '50' },
    });
    expect(onGoal).toHaveBeenCalledWith('50');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(onSeek).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('writes the found value only after the solution is confirmed', () => {
    const onApply = vi.fn();
    const onEdit = vi.fn();
    render(() => (
      <SpreadsheetGoalSeekDialog
        open
        onClose={() => {}}
        setCell="B1"
        onSetCell={() => {}}
        goal="50"
        onGoal={() => {}}
        changingCell="A1"
        onChangingCell={() => {}}
        seeking={false}
        solution={{
          status: 'found',
          input: '10',
          value: 10,
          result: 50,
          evaluations: 3,
          setSheetId: 'sheet1',
          setAddress: 'B1',
          changeSheetId: 'sheet1',
          changeAddress: 'A1',
        }}
        message=""
        onSeek={() => {}}
        onApply={onApply}
        onEdit={onEdit}
      />
    ));
    expect(screen.getByRole('status').textContent).toMatch(
      /A1 becomes 10, and B1 equals 50/
    );
    fireEvent.click(screen.getByRole('button', { name: 'Change cells' }));
    expect(onEdit).toHaveBeenCalledOnce();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(onApply).toHaveBeenCalledOnce();
  });
});
