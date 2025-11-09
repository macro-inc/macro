import { EntityIcon } from '@core/component/EntityIcon';
import { TextButton } from '@core/component/TextButton';
import CheckIcon from '@icon/regular/arrow-right.svg';

export type JoinChannelDialogProps = {
  channelName: string;
  participantCount: number;
  onSelect: (selection: 'ACCEPTED' | 'REJECTED') => void;
};

export function JoinChannelDialog(props: JoinChannelDialogProps) {
  return (
    <div class="flex-1 w-full h-full flex flex-col items-center justify-center">
      <div class="flex flex-col items-center justify-center gap-4 bg-dialog ">
        <div class="flex flex-col items-center gap-1">
          <p class="text-sm">You've been invited to join</p>
          <div class="flex flex-row items-center gap-2 ">
            <div class="h-8 w-8">
              <EntityIcon targetType="channel" size="fill" />
            </div>

            <h1 class="text-3xl font-bold flex-wrap">{props.channelName}</h1>
          </div>

          <p class="text-sm text-ink-muted">
            {props.participantCount}{' '}
            {props.participantCount === 1 ? 'participant' : 'participants'}
          </p>
        </div>
        <TextButton
          theme="base"
          icon={() => <CheckIcon class="w-4 h-4" />}
          text="Join Channel"
          onClick={() => props.onSelect('ACCEPTED')}
        />
      </div>
    </div>
  );
}
