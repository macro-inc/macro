import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Surface } from './Surface';

describe('Surface', () => {
  afterEach(cleanup);

  it('uses the layer-relative surface background by default', () => {
    render(() => <Surface data-testid="surface" />);

    expect(screen.getByTestId('surface').classList).toContain('bg-surface');
  });

  it('allows an explicit semantic background to override the default', () => {
    render(() => <Surface data-testid="surface" class="bg-panel" />);

    const surface = screen.getByTestId('surface');
    expect(surface.classList).toContain('bg-panel');
    expect(surface.classList).not.toContain('bg-surface');
  });
});
