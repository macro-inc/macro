import { ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import { tourTarget } from '@ui/components/Tour';
import { AGENTS_TOUR } from '../../tour';
import { useAgentsSidebar } from './context';

export function AgentsSidebarFooter() {
  const sidebar = useAgentsSidebar();
  return (
    <ViewSidebar.Footer>
      <ViewSidebar.Nav aria-label={t('agentWork.agentTools')}>
        <ViewSidebar.Item
          active={sidebar.activePage === 'agents'}
          onClick={() => sidebar.onOpenPage('agents')}
          ref={tourTarget(AGENTS_TOUR.rosterNav)}
        >
          <ViewSidebar.Icon>
            <AgentIcon class="size-4" />
          </ViewSidebar.Icon>
          <span>{t('agentWork.agents')}</span>
        </ViewSidebar.Item>
        <ViewSidebar.Item
          active={sidebar.activePage === 'routines'}
          onClick={() => sidebar.onOpenPage('routines')}
        >
          <ViewSidebar.Icon>
            <RoutineIcon class="size-4" />
          </ViewSidebar.Icon>
          <span>{t('agentWork.routines')}</span>
        </ViewSidebar.Item>
        <ViewSidebar.Item
          active={sidebar.activePage === 'archived'}
          onClick={() => sidebar.onOpenPage('archived')}
        >
          <ViewSidebar.Icon>
            <ArchiveIcon class="size-4" />
          </ViewSidebar.Icon>
          <span>{t('viewMenus.archived')}</span>
        </ViewSidebar.Item>
      </ViewSidebar.Nav>
    </ViewSidebar.Footer>
  );
}
