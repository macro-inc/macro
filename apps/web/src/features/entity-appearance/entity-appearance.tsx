import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { EntityIcon, getEntityIconType } from '@core/component/EntityIcon';
import {
  enableEntityAppearance,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { lazyNamed } from '@core/util/lazyNamed';
import { Button } from '@ui/components/Button';
import { openDialog } from '@ui/components/ImperativeDialog';
import { Show } from 'solid-js';
import type { EntityData } from '../entity/types/entity';
import { supportsEntityAppearance } from './core/appearance';

const AppearanceDialog = lazyNamed(
  () => import('./appearance-dialog'),
  'AppearanceDialog'
);

/** Capture account context outside handlers; the editor survives its launching menu. */
export function useChangeEntityIcon() {
  const userId = useUserId();
  return (entity: EntityData, element?: HTMLElement) => {
    const actor = userId();
    if (
      !isFeatureEnabled(enableEntityAppearance) ||
      !actor ||
      !supportsEntityAppearance(entity)
    )
      return;
    const rect = element?.getBoundingClientRect();
    return openDialog(
      AppearanceDialog,
      {
        entity,
        userId: actor,
        anchor: rect
          ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
          : undefined,
        isCurrent: () => userId() === actor,
      },
      { key: `entity-appearance:${actor}:${entity.type}:${entity.id}` }
    );
  };
}

/** Identity editing belongs in headers only. Row icons remain navigation targets. */
export function EntityAppearanceTrigger(props: {
  entity: EntityData;
  editable: boolean;
}) {
  const icon = () => (
    <EntityIcon
      targetType={getEntityIconType(props.entity)}
      appearance={props.entity.appearance}
      size="xs"
    />
  );
  return (
    <Show
      when={props.editable && supportsEntityAppearance(props.entity)}
      fallback={icon()}
    >
      <EditableAppearanceTrigger entity={props.entity} />
    </Show>
  );
}

function EditableAppearanceTrigger(props: { entity: EntityData }) {
  const changeIcon = useChangeEntityIcon();
  const flag = useFeatureFlag(enableEntityAppearance);
  const icon = (
    <EntityIcon
      targetType={getEntityIconType(props.entity)}
      appearance={props.entity.appearance}
      size="xs"
    />
  );
  return (
    <Show when={flag().enabled} fallback={icon}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t('appearance.title')}
        tooltip={t('appearance.title')}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          changeIcon(props.entity, event.currentTarget);
        }}
      >
        {icon}
      </Button>
    </Show>
  );
}
