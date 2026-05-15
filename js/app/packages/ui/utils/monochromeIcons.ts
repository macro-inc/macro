import { monochromeIcons } from '../signals/signals';
import { createEffect, createRoot } from 'solid-js';

export function initMonochromeIcons() {
  createRoot(() => {
    createEffect(() => {
      if (monochromeIcons()) {
        document.documentElement.style.setProperty('--color-calendar', 'var(--c0)');
        document.documentElement.style.setProperty('--color-contact',  'var(--c0)');
        document.documentElement.style.setProperty('--color-canvas',   'var(--c0)');
        document.documentElement.style.setProperty('--color-folder',   'var(--c0)');
        document.documentElement.style.setProperty('--color-image',    'var(--c0)');
        document.documentElement.style.setProperty('--color-video',    'var(--c0)');
        document.documentElement.style.setProperty('--color-write',    'var(--c0)');
        document.documentElement.style.setProperty('--color-code',     'var(--c0)');
        document.documentElement.style.setProperty('--color-chat',     'var(--c0)');
        document.documentElement.style.setProperty('--color-html',     'var(--c0)');
        document.documentElement.style.setProperty('--color-note',     'var(--c0)');
        document.documentElement.style.setProperty('--color-task',     'var(--c0)');
        document.documentElement.style.setProperty('--color-pdf',      'var(--c0)');
        document.documentElement.style.setProperty('--color-rss',      'var(--c0)');
      }
      else {
        document.documentElement.style.removeProperty('--color-calendar');
        document.documentElement.style.removeProperty('--color-contact');
        document.documentElement.style.removeProperty('--color-canvas');
        document.documentElement.style.removeProperty('--color-folder');
        document.documentElement.style.removeProperty('--color-image');
        document.documentElement.style.removeProperty('--color-video');
        document.documentElement.style.removeProperty('--color-write');
        document.documentElement.style.removeProperty('--color-code');
        document.documentElement.style.removeProperty('--color-chat');
        document.documentElement.style.removeProperty('--color-html');
        document.documentElement.style.removeProperty('--color-note');
        document.documentElement.style.removeProperty('--color-task');
        document.documentElement.style.removeProperty('--color-pdf');
        document.documentElement.style.removeProperty('--color-rss');
      }
    });
  });
}
