import { EntityIcon } from '@core/component/EntityIcon';
import {
  ShareCard,
  ShareDialogFrame,
  ShareDialogTitle,
} from '@core/component/TopBar/ShareDialogFrame';
import { isMobile } from '@core/mobile/isMobile';
import CopyIcon from '@icon/system/regular/copy.svg';
import type { RoutineTemplate } from '@service-scheduled-action/generated/schemas';
import { Button, cn } from '@ui';
import { type JSX, Show } from 'solid-js';

/**
 * A routine's Share menu. Sending it or copying its link shares the routine's
 * current setup; each person who opens it can activate their own copy.
 */
export function ShareRoutineDialog(props: {
  open: boolean;
  onOpenChange(open: boolean): void;
  name: string;
  /** `undefined` while loading, `null` when not shared yet. */
  template: RoutineTemplate | null | undefined;
  pending: boolean;
  onCopyLink(): void;
  onStopSharing(): void;
  /** The standard send form: recipients, optional message, Share. */
  send: JSX.Element;
  /** The send form's submit, which phones show beside the title. */
  sendAction?: { canSubmit(): boolean; submit(): void };
}) {
  const shared = () => Boolean(props.template);
  return (
    <ShareDialogFrame open={props.open} onOpenChange={props.onOpenChange}>
      <ShareCard
        header={
          <div class="flex w-full min-w-0 items-center justify-between gap-2">
            <ShareDialogTitle
              icon={
                <EntityIcon targetType="routine" size="sm" class="shrink-0" />
              }
              name={props.name}
            />
            <Show when={isMobile() && props.sendAction}>
              {(action) => (
                <Button
                  variant="primary"
                  size="sm"
                  class="shrink-0"
                  disabled={!action().canSubmit()}
                  onClick={() => action().submit()}
                >
                  Share
                </Button>
              )}
            </Show>
          </div>
        }
      >
        {props.send}
      </ShareCard>
      <ShareCard>
        <div class="flex flex-col gap-3 p-4 text-sm text-ink">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <span class="font-medium">Anyone with the link</span>
              <div
                class={cn(
                  'flex items-center justify-center rounded-xl border px-2 py-0.5',
                  shared()
                    ? 'border-accent/30 bg-accent/10 text-accent'
                    : 'border-edge-muted bg-edge-muted text-ink-extra-muted'
                )}
              >
                <span class="text-xs font-medium whitespace-nowrap">
                  {shared() ? 'Shared' : 'Just me'}
                </span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <Show when={shared()}>
                <Button
                  variant="ghost"
                  disabled={props.pending}
                  onClick={() => props.onStopSharing()}
                >
                  Stop sharing
                </Button>
              </Show>
              <Button
                variant="secondary"
                disabled={props.pending || props.template === undefined}
                onClick={() => props.onCopyLink()}
              >
                <CopyIcon class="size-4" />
                <span>Copy Link</span>
              </Button>
            </div>
          </div>
          <p class="text-ink-muted">
            <Show
              when={props.template}
              fallback="People you share with can activate their own copy. Your runs stay private."
            >
              {(template) =>
                template().active_count === 1
                  ? 'Active for 1 person. Your runs stay private.'
                  : `Active for ${template().active_count} people. Your runs stay private.`
              }
            </Show>
          </p>
        </div>
      </ShareCard>
    </ShareDialogFrame>
  );
}
