import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';
import { ButtonGroup } from './ButtonGroup';

afterEach(cleanup);

describe('Button', () => {
  it('disables activation while loading and preserves its accessible name', () => {
    const [loading, setLoading] = createSignal(false);
    const onClick = vi.fn();
    render(() => (
      <Button loading={loading()} onClick={onClick}>
        Save
      </Button>
    ));
    const button = screen.getByRole('button', { name: 'Save' });
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);

    setLoading(true);
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save' })).toBe(button);

    setLoading(false);
    expect(button.hasAttribute('disabled')).toBe(false);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('inherits group settings only through explicit segments', () => {
    render(() => (
      <ButtonGroup variant="secondary" size="sm">
        <ButtonGroup.Button>Save</ButtonGroup.Button>
        <ButtonGroup.Button variant="primary" size="lg">
          Publish
        </ButtonGroup.Button>
        <Button>Independent</Button>
      </ButtonGroup>
    ));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save.getAttribute('data-variant')).toBe('secondary');
    expect(save.getAttribute('data-size')).toBe('sm');
    const publish = screen.getByRole('button', { name: 'Publish' });
    expect(publish.getAttribute('data-variant')).toBe('primary');
    expect(publish.getAttribute('data-size')).toBe('lg');
    const independent = screen.getByRole('button', { name: 'Independent' });
    expect(independent.getAttribute('data-variant')).toBe('primary');
    expect(independent.getAttribute('data-size')).toBe('md');
  });
});
