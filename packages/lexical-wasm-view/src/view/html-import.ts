/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * MIT licensed. DOM import selection, implicitWrappers and built-in conversions retargeted
 * from Lexical 0.45.0, 0cfcc169296723e07de2396cd42ea3434b5b79ed.
 */

import { convertText, importLineBreak, isBlockDOM } from './html-text';
import { macroConversion } from './macro-html';
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
function wrapInlines(
  nodes: readonly JsonObject[],
  implicitWrappers?: WeakSet<JsonObject>,
  format = ''
): JsonObject[] {
  const output: JsonObject[] = [];
  let inline: JsonObject[] = [];
  const wrap = () => {
    const node = { ...paragraph(inline, true), format };
    implicitWrappers?.add(node);
    output.push(node);
    inline = [];
  };
  for (const node of nodes) {
    if (isBlock(node)) {
      if (inline.length) wrap();
      if (format && !node.format) {
        const aligned = { ...node, format };
        if (implicitWrappers?.has(node)) implicitWrappers.add(aligned);
        output.push(aligned);
      } else output.push(node);
    } else inline.push(node);
  }
  if (inline.length) wrap();
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
  const OrderedListType = window.HTMLOListElement;
  const CellType = window.HTMLTableCellElement;
  const RowType = window.HTMLTableRowElement;
  const parsed = new window.DOMParser().parseFromString(html, 'text/html');
  const macroTypes = registry?.names();
  const implicitWrappers = new WeakSet<JsonObject>();
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
    const wrap = (items: readonly JsonObject[]) =>
      wrapInlines(items, implicitWrappers, node.style.textAlign);
    const createElement = (
      type: string,
      items: readonly JsonObject[],
      extra: JsonObject = {}
    ) =>
      element(type, isBlockDOM(node, ElementType) ? wrap(items) : items, extra);

    let custom: DraftConversion | null = macroConversion(node, macroTypes);
    for (const importer of registry?.importers(tag) ?? []) {
      const candidate = importer(node);
      if (candidate && (!custom || candidate.priority >= custom.priority))
        custom = candidate;
    }
    if (custom) {
      const converted = custom.convert(node, values);
      if (converted !== null) return [...converted];
      return isBlockDOM(node, ElementType) ? wrap(values) : values;
    }
    const base: JsonObject = {
      direction: node.dir === 'ltr' || node.dir === 'rtl' ? node.dir : null,
      format: node.style.textAlign || '',
      indent: 0,
    };
    if (tag === 'p') return [{ ...paragraph(wrap(values)), ...base }];
    if (/^h[1-6]$/.test(tag))
      return [createElement('heading', values, { ...base, tag })];
    if (tag === 'blockquote') return [createElement('quote', values, base)];
    if (tag === 'ul' || tag === 'ol') {
      const check =
        node.getAttribute('__lexicallisttype') === 'check' ||
        node.classList.contains('contains-task-list') ||
        node.getAttribute('data-is-checklist') === '1' ||
        [...node.children].some(
          (child) =>
            child instanceof ElementType && child.hasAttribute('aria-checked')
        );
      return [
        createElement(
          'list',
          normalizeList(values).map((item) => {
            const fields = Object.fromEntries(
              Object.entries(item).filter(([key]) => key !== 'checked')
            );
            return check && tag !== 'ol'
              ? { ...fields, checked: item.checked === true }
              : fields;
          }),
          {
            direction: base.direction,
            listType: tag === 'ol' ? 'number' : check ? 'check' : 'bullet',
            tag,
            start: node instanceof OrderedListType ? node.start : 1,
          }
        ),
      ];
    }
    if (tag === 'li') {
      let input: Element | undefined;
      if (node.classList.contains('task-list-item'))
        input = [...node.children].find((child) => child.tagName === 'INPUT');
      if (!input && node.classList.contains('joplin-checkbox')) {
        for (const child of node.children) {
          const first = child.children[0];
          if (
            child.classList.contains('checkbox-wrapper') &&
            first?.tagName === 'INPUT'
          ) {
            input = first;
            break;
          }
        }
      }
      let properties: JsonObject;
      if (input) {
        if (input.getAttribute('type') !== 'checkbox') return values;
        properties = { value: 1, checked: input.hasAttribute('checked') };
      } else {
        const checked = node.getAttribute('aria-checked');
        properties = {
          ...base,
          value: 1,
          ...(checked === 'true'
            ? { checked: true }
            : checked === 'false'
              ? { checked: false }
              : {}),
        };
      }
      const first = values[0];
      if (
        values.length === 1 &&
        first?.type === 'paragraph' &&
        !implicitWrappers.has(first) &&
        !properties.format &&
        typeof first.format === 'string' &&
        first.format
      ) {
        properties = { ...properties, format: first.format };
        values = objectChildren(first);
      }
      return [createElement('listitem', values, properties)];
    }
    if (tag === 'a') {
      if (!node.textContent && node.children.length === 0) return [];
      return [
        createElement('link', values, {
          ...base,
          url: node.getAttribute('href') ?? '',
          target: node.getAttribute('target'),
          rel: node.getAttribute('rel'),
          title: node.getAttribute('title'),
        }),
      ];
    }
    if (
      tag === 'pre' ||
      codeBlock ||
      (tag === 'div' && node.style.fontFamily.includes('monospace')) ||
      (tag === 'table' && node.classList.contains('js-file-line-container'))
    ) {
      const language =
        tag === 'div' || tag === 'table'
          ? null
          : node.getAttribute('data-language');
      return [
        createElement('code', values, { ...(language ? { language } : {}) }),
      ];
    }
    const codeTable = node
      .closest('table')
      ?.classList.contains('js-file-line-container');
    if (
      (tag === 'td' &&
        (node.classList.contains('js-file-line') || codeTable)) ||
      (tag === 'tr' && codeTable)
    )
      return isBlockDOM(node, ElementType) ? wrap(values) : values;
    if (tag === 'table') return [createElement('table', values, base)];
    if (tag === 'tr') {
      const height = Number.parseFloat(node.style.height);
      return [
        createElement('tablerow', values, {
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
        createElement('tablecell', values, {
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
    if (isBlockDOM(node, ElementType)) return wrap(values);
    return values;
  }
  // Resolve upstream's artificial inline wrappers only after their actual
  // converted block ancestry is known; no wrapper reaches the native model.
  function mergeListItemChildren(items: readonly JsonObject[]): JsonObject[] {
    return items.flatMap((node) =>
      !implicitWrappers.has(node) &&
      (node.type === 'paragraph' || node.type === 'listitem')
        ? mergeListItemChildren(objectChildren(node))
        : [node]
    );
  }
  function resolveWrappers(
    items: readonly JsonObject[],
    ancestor: boolean,
    parent?: string
  ): JsonObject[] {
    const input = parent === 'listitem' ? mergeListItemChildren(items) : items;
    const output: JsonObject[] = [];
    for (const [index, node] of input.entries()) {
      const implicit = implicitWrappers.has(node);
      if (implicit && ancestor) {
        output.push(...resolveWrappers(objectChildren(node), ancestor));
        const next = input[index + 1];
        if (next && implicitWrappers.has(next))
          output.push({ type: 'linebreak', version: 1 });
        continue;
      }
      const elementNode =
        isBlock(node) ||
        ['link', 'autolink', 'mark'].includes(String(node.type));
      if (!elementNode) {
        output.push(node);
        continue;
      }
      let context = ancestor;
      if (!implicit)
        context = node.type === 'tablecell' ? false : ancestor || isBlock(node);
      output.push({
        ...node,
        children: resolveWrappers(
          objectChildren(node),
          context,
          String(node.type)
        ),
      });
    }
    return output;
  }
  return resolveWrappers(children(parsed.body, new Map()), false).map((node) =>
    JSON.stringify(node)
  );
}
