#!/usr/bin/env bun
/**
 * Standalone email perf benchmark (vitest is blocked in this VM's proc scan).
 * Run: bun apps/web/scripts/email-render-perf-benchmark.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
const { window } = dom;
globalThis.window = window as unknown as Window & typeof globalThis;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.Node = window.Node;
globalThis.HTMLElement = window.HTMLElement;
globalThis.location = window.location;

const now = () => Date.now();

const { parseEmailContent, parseEmailHtmlStructure } = await import(
  '../src/lib/core/email/parse-email-html.ts'
);

const fixtureDir = join(import.meta.dir, '../src/lib/core/email/tests/fixtures');
const styledEmail = JSON.parse(
  readFileSync(join(fixtureDir, 'styled-email.json'), 'utf8')
);
const wideTable = JSON.parse(
  readFileSync(join(fixtureDir, 'wide-table.json'), 'utf8')
);

function populateMessageDiv(messageDiv: HTMLDivElement, html: string) {
  messageDiv.innerHTML = html;
  for (const a of messageDiv.querySelectorAll('a[href]')) {
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
}

function mountWithFullRebuild(html: string, iterations: number) {
  const start = now();
  for (let i = 0; i < iterations; i++) {
    const hostContainer = document.createElement('div');
    const shadow = hostContainer.attachShadow({ mode: 'open' });
    const styleEl = document.createElement('style');
    styleEl.textContent = 'img{max-width:100%}';
    shadow.appendChild(styleEl);
    const messageDiv = document.createElement('div');
    populateMessageDiv(messageDiv, html);
    shadow.appendChild(messageDiv);
    document.body.appendChild(hostContainer);
    document.body.removeChild(hostContainer);
  }
  return now() - start;
}

function mountWithStableHost(html: string, iterations: number) {
  const hostContainer = document.createElement('div');
  const shadow = hostContainer.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = 'img{max-width:100%}';
  shadow.appendChild(styleEl);
  const messageDiv = document.createElement('div');
  shadow.appendChild(messageDiv);
  document.body.appendChild(hostContainer);

  const start = now();
  for (let i = 0; i < iterations; i++) {
    populateMessageDiv(messageDiv, html);
  }
  document.body.removeChild(hostContainer);
  return now() - start;
}

function legacyStructurePasses(html: string) {
  const start = now();
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.body.querySelector('.macro_quote');
  const doc2 = parser.parseFromString(html, 'text/html');
  doc2.body.textContent?.replace(/\s+/g, ' ').trim();
  const doc3 = parser.parseFromString(html, 'text/html');
  const quoted = doc3.body.querySelector('.macro_quote');
  if (quoted) quoted.remove();
  return now() - start;
}

const html = parseEmailContent(styledEmail.body_html_sanitized).mainContent;
const iterations = 30;

const rebuildMs = mountWithFullRebuild(html, iterations);
const stableMs = mountWithStableHost(html, iterations);

const wideHtml = wideTable.body_html_sanitized;
const structureIterations = 40;
let legacyTotal = 0;
let structureTotal = 0;
for (let i = 0; i < structureIterations; i++) {
  legacyTotal += legacyStructurePasses(wideHtml);
  const start = now();
  parseEmailHtmlStructure(wideHtml);
  structureTotal += now() - start;
}

const structure = parseEmailHtmlStructure(
  '<p>Hi</p><div class="macro_quote">quoted</div>'
);
const structureOk =
  structure.hasQuote &&
  Boolean(structure.replylessHtml?.includes('<p>Hi</p>')) &&
  !structure.replylessHtml?.includes('macro_quote');

const result = {
  shadowHost: {
    iterations,
    fullRebuildMs: rebuildMs,
    stableHostMs: stableMs,
    speedupRatio: rebuildMs / stableMs,
    stableFaster: stableMs < rebuildMs * 0.75,
  },
  structureParse: {
    iterations: structureIterations,
    legacyThreePassMs: legacyTotal,
    singlePassMs: structureTotal,
    speedupRatio: legacyTotal / structureTotal,
    singlePassFaster: structureTotal < legacyTotal * 0.8,
  },
  structureCorrectness: structureOk,
};

console.log(JSON.stringify(result, null, 2));

const allPass =
  result.shadowHost.stableFaster &&
  result.structureParse.singlePassFaster &&
  result.structureCorrectness;

process.exit(allPass ? 0 : 1);
