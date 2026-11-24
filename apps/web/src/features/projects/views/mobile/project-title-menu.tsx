import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { isMobile } from '@core/mobile/isMobile';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import type { ProjectTitleMenuViewProps } from '../../project-title-menu';
import {
  ProjectTitleActions,
  ProjectTitleLabel,
} from '../shared/project-title-parts';

export function MobileProjectTitleMenu(props: ProjectTitleMenuViewProps) {
  const panel = useSplitPanelOrThrow();
  const open = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    panel.titleFileMenuTrigger()?.();
  };
  return (
    <>
      <MobileHeader.Island class="shrink">
        <button
          type="button"
          class="flex h-full min-w-0 max-w-[min(65vw,18rem)] items-center gap-1.5"
          aria-label={`${props.project.name} actions`}
          aria-haspopup="dialog"
          onClick={open}
        >
          <ProjectTitleLabel project={props.project} />
          <CaretDownIcon class="size-3.5 shrink-0 text-ink-muted" />
        </button>
      </MobileHeader.Island>
      <ProjectTitleActions
        project={props.project}
        tools={[
          ...(!isMobile() ? [props.actions.openInNewSplit] : []),
          props.actions.rename,
          props.actions.status,
          props.actions.priority,
          props.actions.share,
          props.actions.remove,
        ]}
      />
    </>
  );
}
