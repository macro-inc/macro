import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Appearance } from './Appearance';

vi.mock('./LanguageSettings', () => ({ LanguageSettings: () => null }));

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('appearance settings', () => {
  // The default themes' hex grays convert to OKLCH with a chroma like 5e-16,
  // which once crashed the editor's color pickers as it opened.
  it('opens the theme editor for the default light and dark themes', () => {
    render(() => <Appearance />);

    fireEvent.click(screen.getByRole('button', { name: 'Edit Macro Light' }));
    expect(screen.getByRole('textbox', { name: 'Theme name' })).toHaveProperty(
      'value',
      'Macro Light copy'
    );

    fireEvent.click(screen.getByRole('button', { name: 'Edit Macro Dark' }));
    const names = screen
      .getAllByRole('textbox', { name: 'Theme name' })
      .map((input) => (input as HTMLInputElement).value);
    expect(names).toEqual(['Macro Light copy', 'Macro Dark copy']);
  });
});
