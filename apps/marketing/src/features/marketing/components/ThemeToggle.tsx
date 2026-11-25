import Moon from '@phosphor/moon.svg';
import Sun from '@phosphor/sun.svg';
import { choosePalette, sitePalette } from '../../setup/sitePalette';
import './theme-toggle.css';

/**
 * Switches the website between its dark and light palettes.
 * Both icons are always rendered and CSS shows the one for the palette on
 * <html>, so prerendered dark markup needs no change for a light visitor.
 */
export function ThemeToggle() {
  const nextPalette = () => (sitePalette() === 'cream' ? 'dark' : 'cream');

  return (
    <button
      type="button"
      class="site-theme-toggle"
      aria-label={
        nextPalette() === 'cream'
          ? 'Switch to light theme'
          : 'Switch to dark theme'
      }
      onClick={() => choosePalette(nextPalette())}
    >
      <Sun class="site-theme-toggle-light" aria-hidden="true" />
      <Moon class="site-theme-toggle-dark" aria-hidden="true" />
    </button>
  );
}
