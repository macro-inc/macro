import '@fontsource-variable/inter';
import {
  type EmailBodyRenderer,
  mountEmailBody,
  type ThemeColorParams,
} from '../src/browser';
import { type EmailBodyInput, prepareEmailBody } from '../src/core';
import './style.css';

export const themes: Record<'light' | 'dark', ThemeColorParams> = {
  light: {
    inkL: 0.2,
    inkC: 0,
    inkH: 0,
    panelL: 0.98,
    accentL: 0.5,
    accentC: 0.15,
    accentH: 250,
  },
  dark: {
    inkL: 0.9,
    inkC: 0,
    inkH: 0,
    panelL: 0.2,
    accentL: 0.75,
    accentC: 0.15,
    accentH: 250,
  },
};
interface Fixture extends EmailBodyInput {
  name: string;
  description: string;
  container_widths?: number[];
  adaptColors?: boolean;
  normalizeFonts?: boolean;
}
const fixtures = Object.values(
  import.meta.glob<Fixture>('../tests/fixtures/*.json', {
    eager: true,
    import: 'default',
  })
);
const select = document.querySelector<HTMLSelectElement>('#fixture')!;
const themeSelect = document.querySelector<HTMLSelectElement>('#theme')!;
const widthInput = document.querySelector<HTMLInputElement>('#width')!;
const fullInput = document.querySelector<HTMLInputElement>('#full')!;
const expandedInput = document.querySelector<HTMLInputElement>('#expanded')!;
const host = document.querySelector<HTMLElement>('#email-host')!;
let renderer: EmailBodyRenderer | undefined;
for (const fixture of fixtures)
  select.add(new Option(fixture.name, fixture.name));
const params = new URLSearchParams(location.search);
select.value = params.get('fixture') ?? fixtures[0].name;
themeSelect.value = params.get('theme') ?? 'light';
widthInput.value = params.get('width') ?? '600';

function renderFixture() {
  const fixture =
    fixtures.find((item) => item.name === select.value) ?? fixtures[0];
  const theme = themes[themeSelect.value === 'dark' ? 'dark' : 'light'];
  document.body.style.backgroundColor = `oklch(${theme.panelL} 0 0)`;
  document.body.style.color = `oklch(${theme.inkL} 0 0)`;
  host.style.width = `${Math.max(240, Math.min(1200, Number(widthInput.value) || 600))}px`;
  document.querySelector('#description')!.textContent = fixture.description;
  const prepared = prepareEmailBody(fixture, {
    showQuotedContent: fullInput.checked,
    images: { remote: 'block' },
  });
  const options = {
    theme,
    adaptColors: fixture.adaptColors ?? !prepared.hasTable,
    normalizeFonts: fixture.normalizeFonts ?? false,
    expanded: expandedInput.checked,
  };
  if (renderer) renderer.update(prepared, options);
  else renderer = mountEmailBody(host, prepared, options);
}
for (const input of [select, themeSelect, widthInput, fullInput, expandedInput])
  input.addEventListener('change', renderFixture);
renderFixture();

// The fixture viewer and browser tests deliberately share the public API.
window.emailRenderer = { prepareEmailBody, mountEmailBody, themes };
declare global {
  interface Window {
    emailRenderer: {
      prepareEmailBody: typeof prepareEmailBody;
      mountEmailBody: typeof mountEmailBody;
      themes: typeof themes;
    };
  }
}
