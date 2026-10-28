import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { macroDarkTheme } from '@theme/themes/macro-dark';
import { macroLightTheme } from '@theme/themes/macro-light';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { AppearanceModePicker } from './appearance-mode-picker';

afterEach(cleanup);

it('offers one mutually exclusive choice and reports the selected appearance mode', () => {
  let chosen = 'system';
  render(() => {
    const [mode, setMode] = createSignal<'system' | 'light' | 'dark'>('system');
    return (
      <AppearanceModePicker
        value={mode()}
        onChange={(value) => {
          chosen = value;
          setMode(value);
        }}
        lightTheme={macroLightTheme}
        darkTheme={macroDarkTheme}
      />
    );
  });
  const selected = () =>
    screen
      .getAllByRole('radio')
      .filter((radio) => (radio as HTMLInputElement).checked);
  expect(selected()).toEqual([screen.getByRole('radio', { name: 'System' })]);
  for (const name of ['Dark', 'Light', 'System']) {
    const radio = screen.getByRole('radio', { name });
    fireEvent.click(radio);
    expect(chosen).toBe(name.toLowerCase());
    expect(selected()).toEqual([radio]);
  }
});
