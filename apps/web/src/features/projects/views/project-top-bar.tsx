import { EntityDetailTopBar } from '@app/components/entity-detail/EntityDetailTopBar';
import type { Accessor, JSX } from 'solid-js';

export function DesktopProjectTopBar(props: {
  titleMenu: JSX.Element;
  navigation: (compact: Accessor<boolean>) => JSX.Element;
  share: JSX.Element;
}) {
  return (
    <EntityDetailTopBar
      titleMenu={props.titleMenu}
      navigation={props.navigation}
    >
      {props.share}
    </EntityDetailTopBar>
  );
}
