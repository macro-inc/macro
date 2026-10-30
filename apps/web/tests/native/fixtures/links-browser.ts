import { listen } from '@tauri-apps/api/event';

declare global {
  interface Window {
    linkFixture: {
      events: { path: string; query: string }[];
      windowClicks: boolean[];
      clickTargets: string[];
      popupUrl: string;
    };
  }
}

window.linkFixture = {
  events: [],
  windowClicks: [],
  clickTargets: [],
  popupUrl: 'https://example.com/programmatic',
};
window.addEventListener('click', (event) => {
  window.linkFixture.windowClicks.push(event.defaultPrevented);
  window.linkFixture.clickTargets.push(
    event.target instanceof HTMLElement ? event.target.id : 'unknown'
  );
});
document.getElementById('stopped')!.addEventListener('click', (event) => {
  event.stopPropagation();
});
document
  .getElementById('prevented-link')!
  .addEventListener('click', (event) => {
    event.preventDefault();
  });
document.getElementById('popup')!.addEventListener('click', () => {
  window.open(window.linkFixture.popupUrl, '_blank', 'noopener,noreferrer');
});
await listen<{ path: string; query: string }>('navigate', ({ payload }) => {
  window.linkFixture.events.push(payload);
});
document.documentElement.dataset.ready = 'true';
