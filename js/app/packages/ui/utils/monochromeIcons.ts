import { monochromeIcons } from '../signals/signals';
import { createEffect } from 'solid-js';

createEffect(() => {
  if (monochromeIcons()) {
    document.documentElement.style.setProperty('--color-calendar', 'var(--c0)');
    document.documentElement.style.setProperty('--color-contact ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-canvas  ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-folder  ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-image   ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-video   ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-write   ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-code    ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-chat    ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-html    ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-note    ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-task    ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-pdf     ', 'var(--c0)');
    document.documentElement.style.setProperty('--color-rss     ', 'var(--c0)');
  }
  else {
    document.documentElement.style.setProperty('--color-calendar', 'oklch(from var(--a0) l c 100deg)');
    document.documentElement.style.setProperty('--color-contact ', 'oklch(from var(--a0) l c  94deg)');
    document.documentElement.style.setProperty('--color-canvas  ', 'oklch(from var(--a0) l c  60deg)');
    document.documentElement.style.setProperty('--color-folder  ', 'oklch(from var(--a0) l c 240deg)');
    document.documentElement.style.setProperty('--color-image   ', 'oklch(from var(--a0) l c  95deg)');
    document.documentElement.style.setProperty('--color-video   ', 'oklch(from var(--a0) l c 277deg)');
    document.documentElement.style.setProperty('--color-write   ', 'oklch(from var(--a0) l c 260deg)');
    document.documentElement.style.setProperty('--color-code    ', 'oklch(from var(--a0) l c 180deg)');
    document.documentElement.style.setProperty('--color-chat    ', 'oklch(from var(--a0) l c 220deg)');
    document.documentElement.style.setProperty('--color-html    ', 'oklch(from var(--a0) l c  47deg)');
    document.documentElement.style.setProperty('--color-note    ', 'oklch(from var(--a0) l c 293deg)');
    document.documentElement.style.setProperty('--color-task    ', 'oklch(from var(--a0) l c 150deg)');
    document.documentElement.style.setProperty('--color-pdf     ', 'oklch(from var(--a0) l c  25deg)');
    document.documentElement.style.setProperty('--color-rss     ', 'oklch(from var(--a0) l c 260deg)');
  }
});
