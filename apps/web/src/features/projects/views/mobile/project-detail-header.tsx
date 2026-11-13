import { t } from '@app/lib/i18n';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import { ProjectProgress } from '../../components/project-progress';
import { ProjectTitleMenu } from '../../components/project-title-menu';
import type { ProjectDetailHeaderProps } from '../../project-detail';
import { ProjectSectionTabs } from '../shared/project-section-tabs';

export function MobileProjectDetailHeader(props: ProjectDetailHeaderProps) {
  return (
    <>
      <MobileHeader
        trailing={
          <>
            <Show
              when={
                isMobile() &&
                props.section === 'tasks' &&
                props.source.project()
              }
            >
              {(project) => (
                <MobileHeader.Island class="size-10 justify-center !px-0">
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
              <Show when={isMobile() && props.section === 'overview'}>
                <MobileHeader.Island class="!px-0">
                  <button
                    type="button"
                    class="flex h-full items-center gap-1 px-3 text-sm font-semibold"
                    onClick={() => props.onSectionChange('tasks')}
                  >
                    <ProjectProgress project={project()} tabIndex={-1} />
                    {t('nav.tasks')}
                  </button>
                </MobileHeader.Island>
              </Show>
            </>
          )}
        </Show>
      </MobileHeader>
      <div class="shrink-0 pt-[calc(var(--mobile-content-inset-top,var(--safe-top,0px))+0.75rem)]">
        <Show when={!isMobile()}>
          <div class="px-4 pb-2">
            <ProjectSectionTabs
              compact={() => false}
              section={props.section}
              onChange={props.onSectionChange}
            />
          </div>
        </Show>
      </div>
    </>
  );
}
