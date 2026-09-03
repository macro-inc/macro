import { Badge } from '@ui';
import { For, Show } from 'solid-js';
import type { DocProp } from '../types';

/** Reference table for a component's public props. */
export function PropsTable(props: { props: DocProp[] }) {
  return (
    <div class="overflow-x-auto rounded-md border border-edge-muted">
      <table class="w-full border-collapse text-sm">
        <thead>
          <tr class="bg-inset">
            <th class="text-left font-medium text-ink-subtle px-3 py-2">
              Prop
            </th>
            <th class="text-left font-medium text-ink-subtle px-3 py-2">
              Type
            </th>
            <th class="text-left font-medium text-ink-subtle px-3 py-2">
              Default
            </th>
            <th class="text-left font-medium text-ink-subtle px-3 py-2">
              Description
            </th>
          </tr>
        </thead>
        <tbody>
          <For each={props.props}>
            {(prop) => (
              <tr class="border-t border-edge-muted align-top">
                <td class="px-3 py-2 whitespace-nowrap">
                  <span class="font-mono text-ink">{prop.name}</span>
                  <Show when={prop.required}>
                    <Badge variant="outline" size="sm" class="ml-2">
                      required
                    </Badge>
                  </Show>
                </td>
                <td class="px-3 py-2 font-mono text-xs text-blue max-w-64">
                  {prop.type}
                </td>
                <td class="px-3 py-2 font-mono text-xs text-ink-subtle whitespace-nowrap">
                  {prop.default ?? '—'}
                </td>
                <td class="px-3 py-2 text-ink-muted">
                  {prop.description ?? ''}
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </div>
  );
}
