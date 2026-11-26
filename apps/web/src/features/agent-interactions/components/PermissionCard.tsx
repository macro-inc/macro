import ShieldCheck from '@icon/system/regular/shield-check.svg';
import { Card, Item } from '@ui';
import { Show } from 'solid-js';
import {
  PermissionOptions,
  type PermissionOptionsProps,
} from './PermissionOptions';

/** A pending decision, with the action separated from its approval controls. */
export function PermissionCard(
  props: PermissionOptionsProps & {
    action?: string;
    detail?: string;
    canAnswer: boolean;
  }
) {
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label="Permission request"
      class="overflow-hidden"
    >
      <Card.Header>
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media>
            <ShieldCheck />
          </Item.Media>
          <Item.Content class="gap-0.5">
            <Card.Title>Approval needed</Card.Title>
            <Card.Description class="leading-5">
              {props.canAnswer
                ? 'Review this action before the agent continues.'
                : 'Waiting for a session editor to approve this action.'}
            </Card.Description>
          </Item.Content>
        </Item>
      </Card.Header>
      <Show when={props.action || props.detail}>
        <Card variant="filled" offset={1} class="mx-3 px-3 py-2.5">
          <Show when={props.action}>
            <div class="text-xs font-medium text-ink-muted [overflow-wrap:anywhere]">
              {props.action}
            </div>
          </Show>
          <Show when={props.detail}>
            <pre class="mt-1 max-h-32 overflow-y-auto font-mono text-xs leading-5 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {props.detail}
            </pre>
          </Show>
        </Card>
      </Show>
      <div class="p-3">
        <Show when={props.canAnswer}>
          <PermissionOptions
            options={props.options}
            disabled={props.disabled}
            onSelect={props.onSelect}
          />
        </Show>
      </div>
    </Card>
  );
}
