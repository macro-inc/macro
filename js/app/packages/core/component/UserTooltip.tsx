import IconCheck from '@icon/regular/check.svg';
import IconCopy from '@icon/regular/copy.svg';
import Trash from '@phosphor-icons/core/regular/trash.svg?component-solid';
import { Button } from '@ui/components/Button';
import { Match, Show, Switch } from 'solid-js';
import { ProfilePicture } from './ProfilePicture';

export type UserTooltipProps = {
  displayName: string;
  email?: string;
  id?: string;
  isDeleted?: boolean;
  copied: boolean;
  onCopyEmail: (e: MouseEvent) => void;
};

export function UserTooltip(props: UserTooltipProps) {
  return (
    <div class="bg-panel text-ink border border-edge-muted rounded-md shadow-lg overflow-hidden">
      {/* User info section */}
      <div class="flex items-center gap-3 p-3">
        {/* Larger user icon on the left */}
        <div class="size-12 shrink-0 rounded-full bg-ink-extra-muted text-panel pointer-events-none">
          <Switch>
            <Match when={props.isDeleted}>
              <div class="size-12 shrink-0 rounded-full bg-ink-extra-muted/50 flex items-center justify-center">
                <Trash class="w-6 h-6 shrink-0" />
              </div>
            </Match>
            <Match when={props.id}>
              <ProfilePicture
                id={props.id}
                sizeClass={{
                  container: 'size-12',
                  icon: 'w-6 h-6',
                  text: 'text-xl leading-none',
                }}
              />
            </Match>
            <Match when={!props.id && props.email}>
              <ProfilePicture
                id={undefined}
                email={props.email}
                sizeClass={{
                  container: 'size-12',
                  icon: 'w-6 h-6',
                  text: 'text-xl leading-none',
                }}
              />
            </Match>
          </Switch>
        </div>

        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-ink truncate">
            {props.displayName}
          </div>
          <Show when={props.email && props.email !== props.displayName}>
            <div class="text-xs text-ink opacity-60 mt-0.5 truncate">
              {props.email}
            </div>
          </Show>
        </div>
      </div>

      <Show when={props.email}>
        <div class="border-t border-edge-muted"></div>
        <div class="p-2">
          <Button
            onClick={props.onCopyEmail}
            class="text-xs text-ink-extramuted transition-all duration-300"
          >
            {props.copied ? (
              <IconCheck class="w-3.5 h-3.5 mr-1" />
            ) : (
              <IconCopy class="w-3.5 h-3.5 mr-1" />
            )}
            Copy email
          </Button>
        </div>
      </Show>
    </div>
  );
}
