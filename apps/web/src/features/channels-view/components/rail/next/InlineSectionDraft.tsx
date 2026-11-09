import { t } from '@app/lib/i18n';
import { triggerFocusInput } from '@core/directive/focusInput';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { catchToResult } from '@core/util/result';
import CheckIcon from '@icon/system/regular/check.svg';
import XIcon from '@icon/system/regular/x.svg';
import { queryReadyGate } from '@queries/gate';
import { useCurrentTeamQuery } from '@queries/team/teams';
import type { ChannelLabel } from '@service-storage/generated/schemas/channelLabel';
import type { ChannelLabelScopeSelection } from '@service-storage/generated/schemas/channelLabelScopeSelection';
import { Button, Dropdown, Input } from '@ui';
import { createSignal, Show } from 'solid-js';

/** Mounted only in response to New section or Rename, never restored on navigation. */
export function InlineSectionDraft(props: {
  label?: ChannelLabel;
  scope: ChannelLabelScopeSelection;
  canShare: boolean;
  teamName?: string;
  onSave: (value: {
    name: string;
    scope: ChannelLabelScopeSelection;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = createSignal(props.label?.name ?? '');
  const [scope, setScope] = createSignal(props.scope);
  const [saving, setSaving] = createSignal(false);
  const team = useCurrentTeamQuery();
  const teamName = () =>
    props.teamName ??
    (queryReadyGate(team) ? team.data?.team.name : undefined) ??
    t('channelSections.team_channels');
  const [error, setError] = createSignal('');
  const save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (saving() || !name().trim()) return;
    setSaving(true);
    setError('');
    const result = await catchToResult(() =>
      props.onSave({ name: name().trim(), scope: scope() })
    );
    setSaving(false);
    if (result.isErr()) setError(t('channelSections.saveSectionFailed'));
  };
  return (
    <form
      class="min-w-0 py-1"
      onSubmit={(event) => fireAndForget(save(event), 'channels-view')}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || saving())
          return;
        event.stopPropagation();
        props.onCancel();
      }}
    >
      <div class="flex min-w-0 items-center gap-1">
        <Input
          ref={(element) => {
            triggerFocusInput(() => element);
            onElementConnect(element, () => element.select());
          }}
          aria-label={t('channelSections.sectionName')}
          placeholder={t('channelSections.sectionName')}
          value={name()}
          maxLength={80}
          readOnly={saving()}
          class="min-w-0 flex-1"
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <Dropdown>
          <Dropdown.Trigger
            as={Button}
            variant="ghost"
            size="xs"
            disabled={saving()}
            aria-label={t('channelSections.visibleTo')}
          >
            {scope() === 'personal' ? t('channelSections.onlyMe') : teamName()}
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.CheckboxItem
              closeOnSelect
              checked={scope() === 'personal'}
              onChange={(checked) => {
                if (checked) setScope('personal');
              }}
            >
              {t('channelSections.onlyMe')}
            </Dropdown.CheckboxItem>
            <Show when={props.canShare}>
              <Dropdown.CheckboxItem
                closeOnSelect
                checked={scope() === 'team'}
                onChange={(checked) => {
                  if (checked) setScope('team');
                }}
              >
                {teamName()}
              </Dropdown.CheckboxItem>
            </Show>
          </Dropdown.Content>
        </Dropdown>
        <Button
          type="submit"
          variant="ghost"
          size="icon-xs"
          aria-label={t('channelSections.saveSection')}
          disabled={saving() || !name().trim()}
        >
          <CheckIcon class="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('channelSections.cancel')}
          disabled={saving()}
          onClick={props.onCancel}
        >
          <XIcon class="size-3.5" />
        </Button>
      </div>
      <Show when={error()}>
        <p role="alert" class="px-2 pt-1 text-xs text-failure-ink">
          {error()}
        </p>
      </Show>
    </form>
  );
}
