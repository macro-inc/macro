import { cleanup, render, screen } from '@solidjs/testing-library';
import type { ComponentProps, JSX, ParentProps } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailDateSelector } from './email-date-selector';

vi.mock('@ui', () => ({
  buttonClasses: () => 'button-base',
  cn: (...values: Array<string | false | null | undefined>) =>
    values.filter(Boolean).join(' '),
  Tooltip: (props: ParentProps) => <>{props.children}</>,
  Surface: (props: ComponentProps<'div'>) => <div {...props} />,
}));
vi.mock('./date-selector', () => ({
  DateSelector: (props: {
    selectedDate?: Date | null;
    triggerClass?: string;
    triggerLabel?: string;
    trigger: (state: { selectedDate: Date | null }) => JSX.Element;
  }) => (
    <button class={props.triggerClass} aria-label={props.triggerLabel}>
      {props.trigger({ selectedDate: props.selectedDate ?? null })}
    </button>
  ),
}));

afterEach(cleanup);

describe('EmailDateSelector', () => {
  it('puts the confirmed scheduled label on a flexible, truncating trigger', () => {
    render(() => (
      <div style={{ width: '150px' }}>
        <EmailDateSelector
          mobile={false}
          state={{
            type: 'scheduled',
            confirmedTime: new Date('2026-12-31T23:59:00Z'),
          }}
          selectedTime={new Date('2026-12-31T23:59:00Z')}
          onSelectTime={vi.fn()}
          operation="idle"
          disablePortal
        />
      </div>
    ));

    const trigger = screen.getByRole('button', {
      name: /Scheduled for .* Open to propose a new time or cancel/,
    });
    expect(trigger.className).toContain('not-touch:w-auto!');
    expect(trigger.className).toContain('aspect-auto!');
    expect(trigger.className).toContain('min-w-0');
    expect(trigger.className).toContain('max-w-full');
    expect(trigger.className).toContain('shrink');
    expect(trigger.querySelector('.truncate')).not.toBeNull();
    expect(trigger.querySelector('button')).toBeNull();
  });

  it('uses an icon-sized trigger on mobile', () => {
    render(() => (
      <EmailDateSelector
        mobile
        state={{
          type: 'scheduled',
          confirmedTime: new Date('2026-12-31T23:59:00Z'),
        }}
        selectedTime={new Date('2026-12-31T23:59:00Z')}
        onSelectTime={vi.fn()}
        operation="idle"
        disablePortal
      />
    ));

    const trigger = screen.getByRole('button', {
      name: /Scheduled for .* Open to propose a new time or cancel/,
    });
    expect(trigger.className).not.toContain('not-touch:w-auto!');
    expect(trigger.querySelector('.truncate')).toBeNull();
  });
});
