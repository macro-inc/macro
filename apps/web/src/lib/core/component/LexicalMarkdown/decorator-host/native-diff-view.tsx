import CheckIcon from '@icon/system/regular/check.svg';
import XIcon from '@icon/system/regular/x.svg';
import { applyElementDirection } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import type { NodeView } from '@macro-inc/lexical-wasm-view/view/registry';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import { render } from 'solid-js/web';
import { dispatchApplicationCommandIfSessionEdit } from '../plugins/group-b/command';

function optionalString(node: ViewNode, name: string): string | undefined {
  const value = node.props()[name];
  if (value !== undefined && typeof value !== 'string')
    throw new Error(`Invalid native diff ${name}`);
  return value;
}

/**
 * The native counterpart of the Source DiffNode DOM factory (diff-factory.tsx):
 * the same owned/external split, header markup and hover classes. Accept and
 * reject run the native model actions for this exact node.
 */
export function createNativeDiffElementView(
  userId: () => string | undefined
): NodeView {
  return {
    createDOM(node, context) {
      const container = context.document.createElement('div');
      container.classList.add('md-diff');
      if (optionalString(node, 'userId') !== userId()) {
        container.classList.add('external');
        // The reconciler sets direction after createDOM, as Source does.
        applyElementDirection(node, container, context);
        return container;
      }
      container.contentEditable = true.toString();
      container.classList.add('flex', 'flex-col-reverse');
      const child = context.document.createElement('div');
      container.appendChild(child);
      const key = node.key;
      const label = optionalString(node, 'label');
      const dispatch = (name: string) =>
        // Accept and reject write only under current session edit access.
        dispatchApplicationCommandIfSessionEdit(context.view, name, { key });
      render(
        () => (
          <div
            class="select-none flex justify-between items-center gap-2 p-1 mb-2 bg-edge"
            contentEditable={false}
          >
            <div class="flex-1 text-sm text-ink-extra-muted ml-1 truncate">
              {label}
            </div>
            <div class="flex gap-1">
              <button
                class="px-2 py-0.5 rounded text-sm flex border border-edge bg-edge items-center gap-2 hover:bg-hover hover-transition-bg"
                onClick={() => dispatch('group-b.diff-reject')}
                onMouseEnter={() =>
                  container.classList.toggle('opt-reject', true)
                }
                onMouseLeave={() => {
                  container.classList.toggle('opt-reject', false);
                }}
              >
                <XIcon class="size-4 text-failure" />
                Reject
              </button>
              <button
                class="px-2 py-0.5 rounded text-sm flex border border-edge bg-edge items-center gap-2 hover:bg-hover hover-transition-bg"
                onClick={() => dispatch('group-b.diff-accept')}
                onMouseEnter={() =>
                  container.classList.toggle('opt-accept', true)
                }
                onMouseLeave={() => {
                  container.classList.toggle('opt-accept', false);
                }}
              >
                <CheckIcon class="size-4 text-success" />
                Accept
              </button>
            </div>
          </div>
        ),
        child
      );
      applyElementDirection(node, container, context);
      return container;
    },
    // Source DiffNode.updateDOM never recreates its element; the reconciler
    // still refreshes the element direction.
    updateDOM(_previous, next, dom, context) {
      applyElementDirection(next, dom, context);
      return false;
    },
    getDOMSlot(_node, dom) {
      const header = dom.classList.contains('external') ? null : dom.firstChild;
      return header ? { element: dom, after: header } : { element: dom };
    },
  };
}
