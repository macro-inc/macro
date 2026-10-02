import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { Button, type ButtonSize, buttonClasses } from './Button';
import { ButtonGroup } from './ButtonGroup';

afterEach(cleanup);

describe('Button emphasis', () => {
  it.each(['md', 'icon-md', 'icon-composer'] satisfies ButtonSize[])(
    'preserves variant emphasis at size %s, including square controls',
    (size) => {
      for (const square of [false, true]) {
        expect(buttonClasses({ variant: 'strong', size, square })).toContain(
          'bg-control'
        );
        expect(buttonClasses({ variant: 'strong', size, square })).toContain(
          'font-semibold'
        );
        expect(buttonClasses({ variant: 'cta', size, square })).toContain(
          'bg-accent '
        );
        expect(buttonClasses({ variant: 'outline', size, square })).toContain(
          'border-edge-button'
        );
      }
    }
  );

  it('can disable glass reactively without changing emphasis or leaking a DOM prop', () => {
    const [glass, setGlass] = createSignal<boolean | undefined>();
    render(() => (
      <Button variant="cta" glass={glass()}>
        Create
      </Button>
    ));
    const button = screen.getByRole('button', { name: 'Create' });
    expect(button.classList.contains('glass')).toBe(false);
    expect(button.classList.contains('touch:glass')).toBe(true);
    setGlass(true);
    expect(button.classList.contains('glass')).toBe(true);
    expect(button.classList.contains('touch:glass')).toBe(false);
    setGlass(false);
    expect(button.classList.contains('touch:glass')).toBe(false);
    expect(button.classList.contains('glass')).toBe(false);
    expect(button.classList.contains('bg-accent')).toBe(true);
    expect(button.hasAttribute('glass')).toBe(false);
  });

  it('preserves emphasis inside a group without giving each segment glass', () => {
    render(() => (
      <ButtonGroup variant="strong">
        <Button>Save</Button>
        <Button>Save all</Button>
      </ButtonGroup>
    ));
    for (const button of screen.getAllByRole('button')) {
      expect(button.classList.contains('bg-control')).toBe(true);
      expect(button.classList.contains('glass')).toBe(false);
    }
  });
});
