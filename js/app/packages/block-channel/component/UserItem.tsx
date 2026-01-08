import { BozzyBracket } from '@core/component/BozzyBracket';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { TruncatedText } from '@core/component/FileList/TruncatedText';
import { UserIcon } from '@core/component/UserIcon';
import { idToEmail } from '@core/user';
import IconX from '@icon/regular/x.svg';
import { createSignal, Show } from 'solid-js';

export type UserItemProps = {
  id: string;
  description: string;
  currentUserId?: string;
  mountPoint?: HTMLDivElement;
  removeParticipant?: () => void;
  editable?: boolean;
};

export function UserItem(props: UserItemProps) {
  const [hovered, setHovered] = createSignal(false);

  return (
    <BozzyBracket hover={hovered()} active={false} class="w-full">
      <div
        class={`flex group flex-row items-center justify-between overflow-x-hidden w-full p-2`}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div class="flex flex-row gap-2 items-center w-full">
          <UserIcon id={props.id} size="md" isDeleted={false} />
          <div class="flex flex-col gap-0 w-full">
            <TruncatedText>
              <p class="text-sm">{idToEmail(props.id)}</p>
            </TruncatedText>
            <p class="text-xs text-ink-muted">{props.description}</p>
          </div>
        </div>
        <Show
          when={props.currentUserId !== props.id && props.editable && hovered()}
        >
          <DeprecatedIconButton
            tooltip={{ label: 'Remove participant' }}
            icon={IconX}
            iconSize={16}
            theme="clear"
            size="sm"
            onClick={props.removeParticipant}
          />
        </Show>
      </div>
    </BozzyBracket>
  );
}
