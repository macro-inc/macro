import {
  Card,
  CardBody,
  CardFooter,
  CardHeader,
} from '@app/features/agent-cards/components/kit/card';
import {
  Tile,
  Well,
  WellText,
} from '@app/features/agent-cards/components/kit/parts';
import CaretRight from '@phosphor/caret-right.svg';
import ShieldCheck from '@phosphor/shield-check.svg';
import { cn } from '@ui';
import { createSignal, Show } from 'solid-js';
import { DEFAULT_ANSWERERS } from '../context/interaction';
import {
  PermissionOptions,
  type PermissionOptionsProps,
} from './PermissionOptions';

/**
 * An action the agent wants to take and needs a yes for, as one card: what
 * it will do in plain words, what it acts on, the raw input folded away,
 * and Deny, More and Allow once - the one call to action. Anyone who cannot
 * answer sees what is waiting and on whom.
 */
export function ApprovalCard(
  props: PermissionOptionsProps & {
    /** The action, as the step reads: `Run command`, `Create document`. */
    action: string;
    /** What it acts on: the command, the document. */
    detail?: string | null;
    /** The tool's raw input, for someone who wants to check it. */
    input?: string;
    canAnswer: boolean;
    /** Who can, for a viewer who cannot: `someone who can edit this agent`. */
    answerers?: string;
  }
) {
  const [showInput, setShowInput] = createSignal(false);
  return (
    <Card width="standard" data-agent-card="approval">
      <section aria-label="Permission request" class="flex min-h-0 flex-col">
        <CardHeader
          wrap
          tile={
            <Tile size={32} tone="accent">
              <ShieldCheck />
            </Tile>
          }
          title={props.action}
          subtitle={
            props.canAnswer
              ? 'Approval needed'
              : `Waiting for ${props.answerers ?? DEFAULT_ANSWERERS} to approve`
          }
        />
        <Show when={props.detail || props.input}>
          <CardBody class="gap-2">
            <Show when={props.detail}>
              {(detail) => (
                <Well class="max-h-32 overflow-y-auto">
                  <WellText class="text-ink">{detail()}</WellText>
                </Well>
              )}
            </Show>
            <Show when={props.input}>
              {(input) => (
                <>
                  <button
                    type="button"
                    class="flex items-center gap-1 self-start text-xs text-ink-muted hover:text-ink"
                    aria-expanded={showInput()}
                    onClick={() => setShowInput((open) => !open)}
                  >
                    <CaretRight
                      class={cn(
                        'size-3 transition-transform',
                        showInput() && 'rotate-90'
                      )}
                    />
                    {showInput() ? 'Hide input' : 'Show input'}
                  </button>
                  <Show when={showInput()}>
                    <Well class="max-h-32 overflow-y-auto">
                      <WellText>{input()}</WellText>
                    </Well>
                  </Show>
                </>
              )}
            </Show>
          </CardBody>
        </Show>
        <Show when={props.canAnswer}>
          <CardFooter>
            <div class="min-w-0 flex-1">
              <PermissionOptions
                options={props.options}
                disabled={props.disabled}
                onSelect={props.onSelect}
                allowVariant="cta"
                size="sm"
              />
            </div>
          </CardFooter>
        </Show>
      </section>
    </Card>
  );
}
