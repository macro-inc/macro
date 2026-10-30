import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { RoutineDescribe } from './routine-describe';

describe('describe a routine', () => {
  it('drafts on Enter, but not on Enter that confirms an input method', () => {
    const onDescribe = vi.fn(async () => undefined);
    render(() => <RoutineDescribe onDescribe={onDescribe} />);
    const box = screen.getByRole('textbox', { name: 'Describe your routine' });
    fireEvent.input(box, { target: { value: '毎朝メールを整理' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(onDescribe).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onDescribe).toHaveBeenCalledWith('毎朝メールを整理');
  });
});
