import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import type { ProjectDetailHeaderProps } from '../../project-detail';
import { ProjectTitleMenu } from '../../project-title-menu';
import { ProjectSectionTabs } from '../shared/project-section-tabs';

export function MobileProjectDetailHeader(props: ProjectDetailHeaderProps) {
  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show when={isMobile() && props.source.project()}>
              {(project) => (
                <MobileHeader.Island class="min-w-10 justify-center !px-0">
                  <ShareTrigger
                    onClick={props.onShare}
                    id={project().id}
                    blockType="initiative"
                    hotkeyScope={props.hotkeyScope}
                    showCopyLink={false}
                  />
                </MobileHeader.Island>
              )}
            </Show>
            <MobileHeader.Info />
          </>
        }
      >
        <Show when={props.source.project()}>
          {(project) => (
            <>
              <ProjectTitleMenu
                project={project()}
                source={props.source}
                commands={props.commands}
                section={props.section}
                onShare={props.onShare}
                onDelete={props.onDelete}
              />
            </>
          )}
        </Show>
      </MobileHeader>
      <Show when={!isMobile()}>
        <div class="shrink-0 px-4 pb-2 pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]">
          <ProjectSectionTabs
            compact={() => false}
            sections={props.sections}
            section={props.section}
            onChange={props.onSectionChange}
          />
        </div>
      </Show>
    </>
  );
}
