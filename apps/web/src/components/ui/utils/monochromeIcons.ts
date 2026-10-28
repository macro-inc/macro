import { createEffect, createRoot } from 'solid-js';
import { monochromeIcons } from '../signals/signals';

export function initMonochromeIcons() {
  createRoot(() => {
    createEffect(() => {
      if (monochromeIcons()) {
        document.documentElement.style.setProperty(
          '--color-calendar',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-contact',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-canvas',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-folder',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-image',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-video',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-write',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-code',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-chat',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-html',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-note',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-task',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-pdf',
          'var(--color-content-0)'
        );
        document.documentElement.style.setProperty(
          '--color-rss',
          'var(--color-content-0)'
        );
      } else {
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
