// The data layer only: the side panel, section, controls and icons are real.
import { EntityIcon } from '@core/component/EntityIcon';

// Real modules, with only their data reads replaced below. Relative paths, so
// the aliases that point here don't loop.
export * from '../../activity/context/activity-context';
export * from '../../property/hooks/index';

function display(id: string) {
  return {
    name: () => `Document ${id}`,
    icon: () => <EntityIcon targetType="md" size="xs" />,
    isLoading: () => false,
    hasPreviewAccess: () => true,
    blockOrFileType: () => 'md',
    linkParams: () => undefined,
    nativeProjectId: () => undefined,
  };
}

export const usePropertyEntityDisplay = (id: () => string) => display(id());
export const useActivityContext = () => ({
  entityDisplay: (id: () => string) => display(id()),
});
export const openEntityInSplit = () => {};
