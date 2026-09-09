import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Checkbox, InlineCheckbox } from './Checkbox';

afterEach(cleanup);

describe('Checkbox', () => {
  it('uses an explicit one-pixel edge instead of the app hairline', () => {
    render(() => (
      <Checkbox>
        <Checkbox.Control data-testid="checkbox-control" />
        <Checkbox.Label>Updates</Checkbox.Label>
      </Checkbox>
    ));

    const control = screen.getByTestId('checkbox-control');
    expect(control.classList).toContain('border-1');
    expect(control.classList).not.toContain('border');
  });

  it('uses the same explicit edge for an unchecked InlineCheckbox', () => {
    const { container } = render(() => <InlineCheckbox checked={false} />);

    const control = container.firstElementChild;
    if (!control) throw new Error('InlineCheckbox did not render');
    expect(control.classList).toContain('border-1');
    expect(control.classList).not.toContain('border');
  });
});
