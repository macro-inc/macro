import { describe, expect, it } from 'vitest';
import {
  parseEmailContent,
  parseEmailHtmlStructure,
} from '../parse-email-html';
import styledEmail from './fixtures/styled-email.json';
import wideTable from './fixtures/wide-table.json';

function personalFontOverrideCss(isPersonal: boolean, isMacroSender: boolean) {
  return isPersonal && !isMacroSender
    ? `*:not(code):not(pre):not(code *):not(pre *):not([data-macro-btn]){font-family: system-ui, sans-serif !important; font-size: inherit !important; line-height: 1.5 !important;}`
    : '';
}

const CONTAINMENT_CSS =
  'img{max-width:100% !important;height:auto !important;display:var(--macro-email-img-display,initial)!important;}';

function populateMessageDiv(messageDiv: HTMLDivElement, html: string) {
  messageDiv.innerHTML = html;
  for (const a of messageDiv.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
}

/** Old path: recreate shadow host (and re-parse innerHTML wiring) on each update. */
function mountWithFullRebuild(html: string, iterations: number) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const hostContainer = document.createElement('div');
    const shadow = hostContainer.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = `${CONTAINMENT_CSS}${personalFontOverrideCss(true, false)}`;
    shadow.appendChild(styleEl);
    const messageDiv = document.createElement('div');
    populateMessageDiv(messageDiv, html);
    shadow.appendChild(messageDiv);
    document.body.appendChild(hostContainer);
    document.body.removeChild(hostContainer);
  }
  return performance.now() - start;
}

/** New path: create shadow once, swap innerHTML on subsequent updates. */
function mountWithStableHost(html: string, iterations: number) {
  const hostContainer = document.createElement('div');
  const shadow = hostContainer.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = `${CONTAINMENT_CSS}${personalFontOverrideCss(true, false)}`;
  shadow.appendChild(styleEl);
  const messageDiv = document.createElement('div');
  shadow.appendChild(messageDiv);
  document.body.appendChild(hostContainer);

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    populateMessageDiv(messageDiv, html);
  }
  document.body.removeChild(hostContainer);
  return performance.now() - start;
}

function legacyStructurePasses(html: string) {
  const start = performance.now();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.body.querySelector('.macro_quote');
  const doc2 = parser.parseFromString(html, 'text/html');
  doc2.body.textContent?.replace(/\s+/g, ' ').trim();
  const doc3 = parser.parseFromString(html, 'text/html');
  const quoted = doc3.body.querySelector('.macro_quote');
  if (quoted) quoted.remove();
  return performance.now() - start;
}

describe('email render perf harness', () => {
  it('stable shadow host updates faster than full rebuilds', () => {
    const html = parseEmailContent(styledEmail.body_html_sanitized).mainContent;
    const iterations = 30;

    const rebuildMs = mountWithFullRebuild(html, iterations);
    const stableMs = mountWithStableHost(html, iterations);

    expect(stableMs).toBeLessThan(rebuildMs * 0.75);
  });

  it('structure parse is cheaper than three legacy DOMParser passes', () => {
    const html = wideTable.body_html_sanitized;
    const iterations = 40;

    let legacyTotal = 0;
    let structureTotal = 0;
    for (let i = 0; i < iterations; i++) {
      legacyTotal += legacyStructurePasses(html);
      const start = performance.now();
      parseEmailHtmlStructure(html);
      structureTotal += performance.now() - start;
    }

    expect(structureTotal).toBeLessThan(legacyTotal * 0.8);
  });
});
