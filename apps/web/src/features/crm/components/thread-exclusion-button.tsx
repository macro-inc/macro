import { t } from '@app/lib/i18n';
import EyeSlashIcon from '@icon/system/regular/eye-slash.svg';
import { ButtonGroup } from '@ui';
import { Show } from 'solid-js';

/** The thread header's privacy toggle shares its state with the title menu. */
export function ThreadExclusionButton(props: {
  visible: boolean;
  excluded: boolean;
  label: string;
  disabledReason?: string;
  onClick: () => void;
}) {
  return (
    <Show when={props.visible}>
      <ButtonGroup.Button
        variant="ghost"
        size="icon-md"
        aria-label={props.label}
        aria-pressed={props.excluded}
        aria-disabled={!!props.disabledReason}
        tooltip={
          props.disabledReason ??
          (props.excluded ? t('crm.privacyExcludedThread') : props.label)
        }
        onClick={() => !props.disabledReason && props.onClick()}
        onMouseDown={(event) => event.preventDefault()}
        data-disabled={props.disabledReason ? '' : undefined}
      >
        <EyeSlashIcon class="size-4" />
      </ButtonGroup.Button>
    </Show>
  );
}
