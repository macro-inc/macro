import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type Accessor, type JSX, Show } from 'solid-js';
import { MobileProjectTopBar } from './views/mobile/project-top-bar';
import { DesktopProjectTopBar } from './views/project-top-bar';

/** A project's top bar: its menu, section tabs and Share. */
export function ProjectTopBar(props: {
  titleMenu: JSX.Element;
  navigation: (compact: Accessor<boolean>) => JSX.Element;
  share: JSX.Element;
}) {
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <DesktopProjectTopBar
          titleMenu={props.titleMenu}
          navigation={props.navigation}
          share={props.share}
        />
      }
    >
      <MobileProjectTopBar
        titleMenu={props.titleMenu}
        navigation={props.navigation}
        share={props.share}
      />
    </Show>
  );
}
