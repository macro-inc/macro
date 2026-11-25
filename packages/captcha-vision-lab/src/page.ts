/**
 * The challenge page. It shows the prompt, the images at opaque URLs and the
 * family's own controls, and its script submits once. It holds nothing about
 * which response is right: option ids are opaque, every control has the same shape, and
 * the server's status is all it shows back.
 */
import { type Challenge, TEXT_LENGTH } from './families.ts';
import { LAB_SUBMIT_PATH, TEXT_INPUT_ID, TEXT_SUBMIT_ID } from './registry.ts';

export type PageOption = {
  optionId: string;
  label: string;
  imageUrl: string | undefined;
};

export type PageContent = {
  challengeId: string;
  kind: Challenge['kind'];
  prompt: string;
  figureUrl: string | undefined;
  options: PageOption[];
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "img-src 'self'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const escapeHtml = (text: string): string =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const optionButton = (option: PageOption): string => {
  const image =
    option.imageUrl === undefined
      ? ''
      : `<img src="${option.imageUrl}" alt="" width="200" height="200">`;
  return (
    `<button type="button" data-lab-option="${option.optionId}">` +
    `<span class="label">${escapeHtml(option.label)}</span>${image}</button>`
  );
};

/** The controls under the prompt, per kind of response. */
const controls = (content: PageContent): string => {
  if (content.kind === 'text') {
    return (
      `<div class="typing"><input id="${TEXT_INPUT_ID}" type="text" ` +
      `maxlength="${TEXT_LENGTH}" autocomplete="off" spellcheck="false">` +
      `<button type="button" id="${TEXT_SUBMIT_ID}">Submit</button></div>`
    );
  }
  return `<div class="options">${content.options.map(optionButton).join('')}</div>`;
};

/**
 * One script for every kind. A choice submits its option; an order
 * collects every option once, then submits them in click order; text
 * submits the input's value. Each submits at most once.
 */
const script = (content: PageContent): string => `
const challengeId = ${JSON.stringify(content.challengeId)};
const kind = ${JSON.stringify(content.kind)};
let sent = false;
const send = async (response) => {
  if (sent) return;
  sent = true;
  const reply = await fetch(${JSON.stringify(LAB_SUBMIT_PATH)}, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ challengeId, response }),
  });
  const body = await reply.json();
  document.getElementById('result').textContent = body.status;
};
const buttons = [...document.querySelectorAll('[data-lab-option]')];
const picked = [];
for (const button of buttons) {
  button.addEventListener('click', () => {
    const optionId = button.dataset.labOption;
    if (kind === 'choice') return send({ kind, optionId });
    if (picked.includes(optionId)) return;
    picked.push(optionId);
    button.disabled = true;
    if (picked.length === buttons.length) return send({ kind, optionIds: picked });
  });
}
const submit = document.getElementById(${JSON.stringify(TEXT_SUBMIT_ID)});
submit?.addEventListener('click', () => {
  const text = document.getElementById(${JSON.stringify(TEXT_INPUT_ID)}).value;
  return send({ kind, text });
});
`;

export const renderPage = (content: PageContent): Response => {
  const figure =
    content.figureUrl === undefined
      ? ''
      : `<img id="figure" src="${content.figureUrl}" alt="">`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lab quiz</title>
<style>
body { font-family: sans-serif; margin: 24px; background: #fff; }
#quiz { display: inline-block; padding: 16px; border: 1px solid #ccc; }
#prompt { font-size: 18px; margin: 0 0 12px; }
#figure { display: block; margin: 0 0 12px; border: 1px solid #999; }
.options { display: grid; grid-template-columns: repeat(2, 220px); gap: 12px; }
.options button { display: flex; flex-direction: column; align-items: center; padding: 6px; background: #fafafa; border: 1px solid #999; cursor: pointer; }
.options button:disabled { opacity: 0.5; }
.label { font-size: 20px; font-weight: bold; margin-bottom: 4px; }
.typing { display: flex; gap: 8px; }
.typing input { font-size: 20px; width: 160px; }
</style></head>
<body><main id="quiz"><p id="prompt">${escapeHtml(content.prompt)}</p>
${figure}${controls(content)}</main>
<p id="result" aria-live="polite"></p>
<script>${script(content)}</script></body></html>`;

  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': CONTENT_SECURITY_POLICY,
    },
  });
};
