import { describe, expect, it } from 'vitest';
import { operatorRanges } from './search-operator-highlight';

function field(html: string) {
  const root = document.createElement('div');
  root.setAttribute('contenteditable', 'true');
  root.innerHTML = html;
  return root;
}

describe('operatorRanges', () => {
  it('covers each typed operator across the field’s text nodes', () => {
    const root = field(
      '<p><span>launch type:</span><span>task </span><span contenteditable="false">Ana Lima</span><span> tag:finance</span></p>'
    );

    expect(operatorRanges(root).map((range) => range.toString())).toEqual([
      'type:task',
      'tag:finance',
    ]);
  });

  it('never runs an operator into a mention pill', () => {
    const root = field(
      '<p><span>tag:fin</span><span contenteditable="false">ance</span></p>'
    );

    expect(operatorRanges(root).map((range) => range.toString())).toEqual([
      'tag:fin',
    ]);
  });
});
