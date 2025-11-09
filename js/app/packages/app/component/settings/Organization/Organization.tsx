import { TabContent } from '@core/component/TabContent';
import ActiveTable from './ActiveTable/ActiveTable';
import InactiveTable from './InactiveTable/InactiveTable';
import OrganizationSettings from './OrganizationSettings/OrganizationSettings';

const OrganizationTab = () => {
  return (
    <div>
      <TabContent title="Organization Settings">
        <div class="mb-12">
          <OrganizationSettings />
        </div>
      </TabContent>
      <TabContent title="Invited Members">
        <div class="mb-12">
          <InactiveTable />
        </div>
      </TabContent>
      <TabContent title="Active Members">
        <div class="mb-20">
          <ActiveTable />
        </div>
      </TabContent>
    </div>
  );
};

export default OrganizationTab;
