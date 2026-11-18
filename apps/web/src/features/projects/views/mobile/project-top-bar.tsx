import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import { isMobile } from '@core/mobile/isMobile';
import { type Accessor, type JSX, Show } from 'solid-js';

/**
 * On a phone the bar keeps its room for the project's name, as phone file
 * headers do: its crumbs compact, and Share and Copy link stay in the
 * project's menu instead of the bar.
 */
export function MobileProjectTopBar(props: {
  titleMenu: JSX.Element;
  navigation: (compact: Accessor<boolean>) => JSX.Element;
  share: JSX.Element;
}) {
  return (
    <EntityDetailTopBar
      titleMenu={props.titleMenu}
      navigation={props.navigation}
      compact={isMobile()}
    >
      <Show when={!isMobile()}>{props.share}</Show>
    </EntityDetailTopBar>
  );
}
