/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. DOM import selection, wrappers and built-in conversions retargeted
 * from Lexical 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */
import { convertText, importLineBreak, isBlockDOM } from './html-text';
import type { DraftConversion, NodeViewRegistry } from './registry';
import type { JsonObject } from './types';
function element(
  type: string,
  children: readonly JsonObject[],
  extra: JsonObject = {}
): JsonObject {
  return {
    type,
    version: 1,
    children,
    direction: null,
    format: '',
    indent: 0,
    ...extra,
  };
}
function paragraph(
  children: readonly JsonObject[],
  inherit = false
): JsonObject {
  let first = children[0];
  while (first && objectChildren(first).length)
    first = objectChildren(first)[0];
  const text =
    inherit && (first?.type === 'text' || first?.type === 'tab')
      ? first
      : undefined;
  return element('paragraph', children, {
    textFormat: typeof text?.format === 'number' ? text.format : 0,
    textStyle: typeof text?.style === 'string' ? text.style : '',
  });
}
function isBlock(node: JsonObject): boolean {
  return [
    'paragraph',
    'heading',
    'quote',
    'code',
    'list',
    'listitem',
    'table',
    'tablerow',
    'tablecell',
    'classed-block',
  ].includes(String(node.type));
}
function wrapInlines(nodes: readonly JsonObject[]): JsonObject[] {
  const output: JsonObject[] = [];
  let inline: JsonObject[] = [];
  for (const node of nodes) {
    if (isBlock(node)) {
      if (inline.length) output.push(paragraph(inline, true));
      inline = [];
      output.push(node);
    } else inline.push(node);
  }
  if (inline.length) output.push(paragraph(inline, true));
  return output;
}
function objectChildren(node: JsonObject): JsonObject[] {
  const children = node.children;
  if (!Array.isArray(children)) return [];
  return children.filter(
    (child): child is JsonObject =>
      child !== null && typeof child === 'object' && !Array.isArray(child)
  );
}
function normalizeList(nodes: readonly JsonObject[]): JsonObject[] {
  const output: JsonObject[] = [];
  for (const node of nodes) {
    if (node.type !== 'listitem') {
      output.push(element('listitem', [node], { value: 1 }));
      continue;
    }
    const children = objectChildren(node);
    const nested =
      children.length > 1
        ? children.filter((child) => child.type === 'list')
        : [];
    output.push(
      nested.length
        ? {
            ...node,
            children: children.filter((child) => child.type !== 'list'),
          }
        : node
    );
    for (const list of nested)
      output.push(element('listitem', [list], { value: 1 }));
  }
  return output;
}
/** Serialized drafts only; model allocation, transforms and keys remain in Rust. */
export function importHTML(
  html: string,
  document: Document,
  registry?: NodeViewRegistry
): string[] {
  const window = document.defaultView;
  if (!window) throw new Error('HTML import requires a browser document');
  const ElementType = window.HTMLElement;
  const InputType = window.HTMLInputElement;
  const CellType = window.HTMLTableCellElement;
  const RowType = window.HTMLTableRowElement;
  const parsed = new window.DOMParser().parseFromString(html, 'text/html');
  function children(
    node: Node,
    formats: ReadonlyMap<string, number>
  ): JsonObject[] {
    return [...node.childNodes].flatMap((child) => convert(child, formats));
  }
  function convert(
    node: Node,
    formats: ReadonlyMap<string, number>
  ): JsonObject[] {
    if (node.nodeType === 3)
      return convertText(
        node,
        [...formats.values()].reduce((bits, value) => bits | value, 0),
        ElementType
      );
    if (!(node instanceof ElementType)) return [];
    const tag = node.tagName.toLowerCase();
    if (['script', 'style'].includes(tag)) return [];
    let nextFormats = formats;
    const codeBlock =
      tag === 'code' &&
      (/\r?\n/.test(node.textContent ?? '') ||
        Boolean(node.querySelector('br')));
    if (
      [
        'b',
        'span',
        'strong',
        'i',
        'em',
        's',
        'u',
        'code',
        'sub',
        'sup',
        'mark',
      ].includes(tag) &&
      !codeBlock
    ) {
      let bits = 0;
      const style = node.style;
      if (
        (tag === 'b' && style.fontWeight !== 'normal') ||
        tag === 'strong' ||
        style.fontWeight === '700' ||
        style.fontWeight === 'bold'
      )
        bits |= 1;
      if (tag === 'i' || tag === 'em' || style.fontStyle === 'italic')
        bits |= 2;
      if (
        tag === 's' ||
        style.textDecoration.split(' ').includes('line-through')
      )
        bits |= 4;
      if (tag === 'u' || style.textDecoration.split(' ').includes('underline'))
        bits |= 8;
      if (tag === 'code') bits |= 16;
      if (tag === 'sub' || style.verticalAlign === 'sub') bits |= 32;
      if (tag === 'sup' || style.verticalAlign === 'super') bits |= 64;
      if (tag === 'mark') bits |= 128;
      nextFormats = new Map(formats).set(tag, bits);
    }
    if (tag === 'br')
      return importLineBreak(node, ElementType)
        ? [{ type: 'linebreak', version: 1 }]
        : [];
    let values = children(node, nextFormats);
    let custom: DraftConversion | null = null;
    for (const importer of registry?.importers(tag) ?? []) {
      const candidate = importer(node);
      if (candidate && (!custom || candidate.priority >= custom.priority))
        custom = candidate;
    }
    if (custom) {
      const converted = custom.convert(node, values);
      if (converted !== null) return [...converted];
      return isBlockDOM(node, ElementType) ? wrapInlines(values) : values;
    }
    const base: JsonObject = {
      direction: node.dir === 'ltr' || node.dir === 'rtl' ? node.dir : null,
      format: node.style.textAlign || '',
      indent: 0,
    };
    if (tag === 'p') return [{ ...paragraph(values), ...base }];
    if (/^h[1-6]$/.test(tag))
      return [element('heading', values, { ...base, tag })];
    if (tag === 'blockquote') return [element('quote', values, base)];
    if (tag === 'ul' || tag === 'ol') {
      const check =
        node.getAttribute('__lexicallisttype') === 'check' ||
        node.classList.contains('contains-task-list') ||
        node.getAttribute('data-is-checklist') === '1' ||
        [...node.children].some((child) => child.hasAttribute('aria-checked'));
      return [
        element('list', normalizeList(values), {
          ...base,
          listType: tag === 'ol' ? 'number' : check ? 'check' : 'bullet',
          tag,
          start: Number(node.getAttribute('start') ?? 1),
        }),
      ];
    }
    if (tag === 'li') {
      const input = node.querySelector('input[type=checkbox]');
      const checked =
        input instanceof InputType
          ? input.checked
          : node.getAttribute('aria-checked') === 'true'
            ? true
            : node.getAttribute('aria-checked') === 'false'
              ? false
              : undefined;
      return [
        element('listitem', values, {
          ...base,
          value: 1,
          ...(checked === undefined ? {} : { checked }),
        }),
      ];
    }
    if (tag === 'a')
      return [
        element('link', values, {
          ...base,
          url: node.getAttribute('href') ?? '',
          target: node.getAttribute('target'),
          rel: node.getAttribute('rel'),
          title: node.getAttribute('title'),
        }),
      ];
    if (
      tag === 'pre' ||
      codeBlock ||
      (tag === 'div' && node.style.fontFamily.includes('monospace'))
    ) {
      const language = node.getAttribute('data-highlight-language');
      return [
        element('code', values, { ...base, ...(language ? { language } : {}) }),
      ];
    }
    if (tag === 'table') return [element('table', values, base)];
    if (tag === 'tr') {
      const height = Number.parseFloat(node.style.height);
      return [
        element('tablerow', values, {
          ...base,
          ...(Number.isNaN(height) ? {} : { height }),
        }),
      ];
    }
    if (tag === 'td' || tag === 'th') {
      if (!(node instanceof CellType)) throw new Error('Invalid cell DOM');
      let headerState = 0;
      if (tag === 'th') {
        const scope = node.getAttribute('scope');
        if (scope === 'col') headerState = 2;
        else if (scope === 'row') headerState = 1;
        else {
          const row = node.parentElement;
          if (
            row instanceof RowType &&
            (row.parentElement?.tagName === 'THEAD' || row.rowIndex === 0)
          )
            headerState |= 1;
          if (node.cellIndex === 0) headerState |= 2;
          if (!headerState) headerState = 1;
        }
      }
      values = values.map((child) => {
        if (child.type !== 'text' && child.type !== 'tab') return child;
        let format = typeof child.format === 'number' ? child.format : 0;
        if (node.style.fontWeight === '700' || node.style.fontWeight === 'bold')
          format ^= 1;
        if (node.style.fontStyle === 'italic') format ^= 2;
        if (node.style.textDecoration.split(' ').includes('line-through'))
          format ^= 4;
        if (node.style.textDecoration.split(' ').includes('underline'))
          format ^= 8;
        let style = typeof child.style === 'string' ? child.style : '';
        if (node.style.color && !style.includes('color:'))
          style += `color: ${node.style.color};`;
        return { ...child, format, style };
      });
      values = wrapInlines(values);
      if (!values.length) values = [paragraph([])];
      const width = /^\d+(?:\.\d+)?px$/.test(node.style.width)
        ? Number.parseFloat(node.style.width)
        : undefined;
      const verticalAlign = node.style.verticalAlign;
      return [
        element('tablecell', values, {
          headerState,
          colSpan: node.colSpan,
          rowSpan: node.rowSpan,
          ...(width === undefined ? {} : { width }),
          backgroundColor: node.style.backgroundColor || null,
          ...(verticalAlign === 'middle' || verticalAlign === 'bottom'
            ? { verticalAlign }
            : {}),
        }),
      ];
    }
    if (isBlockDOM(node, ElementType)) return wrapInlines(values);
    return values;
  }
  return children(parsed.body, new Map()).map((node) => JSON.stringify(node));
}
