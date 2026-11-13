import { t } from '@app/lib/i18n';
import { UserIcon } from '@core/component/UserIcon';
import { SubteamColor } from '@service-auth/generated/schemas/subteamColor';
import { cn } from '@ui';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';

/** Every team color, in the order the picker shows them. */
export const SUBTEAM_COLORS: SubteamColor[] = Object.values(SubteamColor);

function swatchClass(color: SubteamColor) {
  return match(color)
    .with(SubteamColor.violet, () => 'bg-violet/20 text-violet')
    .with(SubteamColor.blue, () => 'bg-blue/20 text-blue')
    .with(SubteamColor.teal, () => 'bg-teal/20 text-teal')
    .with(SubteamColor.cyan, () => 'bg-cyan/20 text-cyan')
    .with(SubteamColor.orange, () => 'bg-orange/20 text-orange')
    .with(SubteamColor.pink, () => 'bg-pink/20 text-pink')
    .with(SubteamColor.lime, () => 'bg-lime/20 text-lime')
    .exhaustive();
}

export function colorName(color: SubteamColor) {
  return match(color)
    .with(SubteamColor.violet, () => t('settingsTeams.colorViolet'))
    .with(SubteamColor.blue, () => t('settingsTeams.colorBlue'))
    .with(SubteamColor.teal, () => t('settingsTeams.colorTeal'))
    .with(SubteamColor.cyan, () => t('settingsTeams.colorCyan'))
    .with(SubteamColor.orange, () => t('settingsTeams.colorOrange'))
    .with(SubteamColor.pink, () => t('settingsTeams.colorPink'))
    .with(SubteamColor.lime, () => t('settingsTeams.colorLime'))
    .exhaustive();
}

/** A team's initial on its color. */
export function SubteamMark(props: {
  name: string;
  color: SubteamColor;
  size?: 'sm' | 'md' | 'lg';
}) {
  return (
    <span
      aria-hidden="true"
      class={cn(
        'inline-flex shrink-0 items-center justify-center font-semibold',
        match(props.size ?? 'md')
          .with('sm', () => 'size-5 rounded text-[10px]')
          .with('md', () => 'size-8 rounded-md text-sm')
          .with('lg', () => 'size-14 rounded-2xl text-2xl')
          .exhaustive(),
        swatchClass(props.color)
      )}
    >
      {props.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

/** Round color buttons for picking a team's color. */
export function SubteamColorPicker(props: {
  value: SubteamColor;
  onChange: (color: SubteamColor) => void;
}) {
  return (
    <div class="flex items-center gap-1.5">
      <For each={SUBTEAM_COLORS}>
        {(color) => (
          <button
            type="button"
            aria-label={t('settingsTeams.color', { color: colorName(color) })}
            aria-pressed={color === props.value}
            class={cn(
              'size-4 rounded-full',
              swatchClass(color),
              color === props.value &&
                'ring-2 ring-ink/70 ring-offset-2 ring-offset-panel'
            )}
            onClick={() => props.onChange(color)}
          />
        )}
      </For>
    </div>
  );
}

/**
 * Overlapping avatars with a count of the rest. Inside a pressable row, pass
 * `inert` so a press on an avatar is the row's, not a DM or a user card.
 */
export function AvatarStack(props: {
  userIds: string[];
  max?: number;
  inert?: boolean;
}) {
  const max = () => props.max ?? 4;

  return (
    <div class="flex items-center">
      <div class="flex -space-x-1">
        <For each={props.userIds.slice(0, max())}>
          {(userId) => (
            <span class="rounded-full ring-2 ring-panel">
              <UserIcon
                id={userId}
                isDeleted={false}
                size="md"
                suppressClick={props.inert}
                showTooltip={!props.inert}
              />
            </span>
          )}
        </For>
      </div>
      <Show when={props.userIds.length > max()}>
        <span class="ml-1.5 text-xs text-ink-muted">
          +{props.userIds.length - max()}
        </span>
      </Show>
    </div>
  );
}
