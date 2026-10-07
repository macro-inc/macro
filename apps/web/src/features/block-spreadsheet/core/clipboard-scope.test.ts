import { afterEach, describe, expect, it } from 'vitest';
import { clipboardTargetInScope } from './clipboard-scope';

afterEach(() => {
  document.body.replaceChildren();
});

function layout(html: string) {
  document.body.innerHTML = html;
  const get = (id: string) => document.getElementById(id) ?? undefined;
  return get;
}

describe('clipboardTargetInScope', () => {
  it('claims the block, its chrome, its focused wrappers, and the body', () => {
    const get = layout(`
      <div id="panel" tabindex="-1">
        <div id="preview" tabindex="-1">
          <div id="toolbar"><button id="tool"></button></div>
          <div id="block" data-block-type="spreadsheet"><button id="tab"></button></div>
        </div>
      </div>
      <div id="sidebar"><button id="row"></button></div>
    `);
    const scope = {
      block: get('block'),
      panel: undefined,
      chrome: [get('toolbar')],
    };
    for (const id of ['block', 'tab', 'tool', 'preview', 'panel'])
      expect(clipboardTargetInScope(get(id)!, scope)).toBe(true);
    expect(clipboardTargetInScope(document.body, scope)).toBe(true);
    expect(clipboardTargetInScope(get('row')!, scope)).toBe(false);
    expect(clipboardTargetInScope(null, scope)).toBe(false);
  });

  it('claims the whole split panel when the sheet is its main content', () => {
    const get = layout(`
      <div id="panel"><button id="close"></button><div id="block"></div></div>
    `);
    expect(
      clipboardTargetInScope(get('close')!, {
        block: get('block'),
        panel: get('panel'),
        chrome: [],
      })
    ).toBe(true);
  });

  it('leaves a host block that embeds the sheet in charge of its clipboard', () => {
    const get = layout(`
      <div id="canvas" data-block-type="canvas" tabindex="0">
        <div id="block" data-block-type="spreadsheet"></div>
      </div>
    `);
    expect(
      clipboardTargetInScope(get('canvas')!, {
        block: get('block'),
        panel: undefined,
        chrome: [],
      })
    ).toBe(false);
  });
});
