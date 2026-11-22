import type { Page } from '@playwright/test';
import { z } from 'zod';

const snapshotSchema = z.object({
  namespace: z.string(),
  json: z.unknown(),
  dom: z.unknown(),
  text: z.string(),
  selection: z.unknown(),
  domSelection: z.unknown(),
});

/** Read the actual mounted EditorView, without a debug global or a state setter. */
export async function nativeSnapshot(
  page: Page,
  moduleURL: string,
  requireCommon = false
) {
  const value = await page
    .getByRole('textbox', { name: 'Document content', exact: true })
    .evaluate(
      async (root, { entry, requireCommon }) => {
        const imported: unknown = await import(entry);
        function field(object: unknown, key: string): unknown {
          if (
            (typeof object !== 'object' || object === null) &&
            typeof object !== 'function'
          )
            throw new Error(`Missing object for ${key}`);
          return Reflect.get(object, key);
        }
        function call(object: unknown, key: string, args: unknown[]): unknown {
          const method = field(object, key);
          if (typeof method !== 'function')
            throw new Error(`Missing actual method ${key}`);
          return Reflect.apply(method, object, args);
        }
        const view = call(field(imported, 'EditorView'), 'fromDOM', [root]);
        const namespace = field(field(view, 'options'), 'namespace');
        if (typeof namespace !== 'string')
          throw new Error('Missing actual instance namespace');
        const serialized = call(field(view, 'query'), 'serializedState', []);
        if (typeof serialized !== 'string')
          throw new Error('Native serializedState did not return JSON');
        function assertCommonDOM() {
          for (const type of [
            'heading',
            'task-list',
            'custom-code',
            'table',
            'quote',
            'link',
            'user-mention',
            'equation',
            'image',
            'comment-mark',
          ]) {
            const nodes = call(field(view, 'query'), 'nodesOfType', [type]);
            if (!Array.isArray(nodes) || !nodes.length)
              throw new Error(`Missing common model nodes: ${type}`);
            for (const node of nodes) {
              const dom = call(view, 'getElementByKey', [field(node, 'key')]);
              if (
                !(dom instanceof HTMLElement) ||
                !dom.isConnected ||
                !root.contains(dom)
              )
                throw new Error(`Missing connected common DOM: ${type}`);
              if (type === 'user-mention' && !dom.textContent?.trim())
                throw new Error('Mention has no rendered content');
              if (type === 'equation' && !dom.querySelector('.katex'))
                throw new Error('Equation has no actual KaTeX rendering');
              if (type === 'image') {
                const image = dom.querySelector('img');
                if (
                  !(image instanceof HTMLImageElement) ||
                  !image.complete ||
                  image.naturalWidth === 0
                )
                  throw new Error('Image has no decoded rendered content');
              }
            }
          }
        }
        if (requireCommon) assertCommonDOM();
        type Tree =
          | string
          | { comment: string }
          | { tag: string; attributes: [string, string][]; children: Tree[] };
        function tree(node: Node): Tree {
          if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
          if (node.nodeType === Node.COMMENT_NODE)
            return { comment: node.textContent ?? '' };
          if (!(node instanceof Element))
            throw new Error(`Unexpected DOM node ${node.nodeType}`);
          const attributes: [string, string][] = [...node.attributes].map(
            ({ name, value }) => [name, value]
          );
          attributes.sort(([a], [b]) => a.localeCompare(b));
          return {
            tag: node.tagName,
            attributes,
            children: [...node.childNodes].map(tree),
          };
        }
        function domPoint(node: Node | null, offset: number) {
          const path: number[] = [];
          while (node && node !== root) {
            const parent: ParentNode | null = node.parentNode;
            if (!parent) return null;
            const children: readonly Node[] = [...parent.childNodes];
            path.unshift(children.indexOf(node));
            node = parent;
          }
          return node === root ? { path, offset } : null;
        }
        function point(value: unknown) {
          const key = field(value, 'key');
          const offset = field(value, 'offset');
          const type = field(value, 'type');
          const path: number[] = [];
          let node = call(view, 'node', [key]);
          if (node === null) throw new Error('Missing actual model point');
          while (node !== null) {
            const parentKey = field(node, 'parent');
            if (parentKey === null) break;
            const parent = call(view, 'node', [parentKey]);
            const children = field(parent, 'children');
            if (!Array.isArray(children))
              throw new Error('Missing actual model children');
            const index = children.indexOf(field(node, 'key'));
            if (index < 0) throw new Error('Model point is detached');
            path.unshift(index);
            node = parent;
          }
          return { path, offset, type };
        }
        const model = field(call(view, 'selection', []), 'selection');
        const kind = field(model, 'kind');
        const caret =
          kind === 'range'
            ? {
                kind,
                anchor: point(field(model, 'anchor')),
                focus: point(field(model, 'focus')),
              }
            : { kind };
        const selection = window.getSelection();
        return {
          namespace,
          json: JSON.parse(serialized),
          dom: tree(root),
          text: root.textContent ?? '',
          selection: caret,
          domSelection: selection
            ? {
                anchor: domPoint(selection.anchorNode, selection.anchorOffset),
                focus: domPoint(selection.focusNode, selection.focusOffset),
              }
            : null,
        };
      },
      { entry: moduleURL, requireCommon }
    );
  return snapshotSchema.parse(value);
}
