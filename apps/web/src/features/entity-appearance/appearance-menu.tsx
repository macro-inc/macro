import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableEntityAppearance } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { useChangeEntityIcon } from './entity-appearance';
import type { AppearanceEntity } from './types';
import { DesktopAppearanceMenu } from './views/appearance-menu';
import { MobileAppearanceMenu } from './views/mobile/appearance-menu';

/** Menus own desktop picker disclosure; touch retains the existing sheet action. */
export function EntityAppearanceMenu(props: {
  entity: AppearanceEntity;
  defer?: (action: () => void) => void;
}) {
  const userId = useUserId();
  const flag = useFeatureFlag(enableEntityAppearance);
  const changeIcon = useChangeEntityIcon();
  return (
    <Show when={flag().enabled && userId()} keyed>
      {(actor) => (
        <Show
          when={isTouchDevice()}
          fallback={
            <DesktopAppearanceMenu
              entity={props.entity}
              userId={actor}
              isCurrent={() => flag().enabled && userId() === actor}
            />
          }
        >
          <MobileAppearanceMenu
            onSelect={() => {
              const entity = props.entity;
              const open = () => changeIcon(entity);
              if (props.defer) props.defer(open);
              else open();
            }}
          />
        </Show>
      )}
    </Show>
  );
}
