import { featureScreens } from '../core/feature-screens';
import { workspaceFeatures } from '../core/workspace-features';
import { FeaturePageSection } from './FeaturePage';

/** The Calendar page: accounts in one view, finding a time, agent invites, and booking links. */
export function CalendarStories() {
  const calendar = workspaceFeatures.calendar;
  const sections = calendar.sections;
  if (!sections) return null;
  return (
    <>
      <FeaturePageSection
        id="calendar-workspace"
        title={calendar.heading}
        description={calendar.detail}
        screen={featureScreens['calendar-workspace']}
      />
      <FeaturePageSection
        id="calendar-team-availability"
        title={sections[0].title}
        description={sections[0].description}
        screen={featureScreens['calendar-team-availability']}
      />
      <FeaturePageSection
        id="calendar-agent-invites"
        title={sections[1].title}
        description={sections[1].description}
        screen={featureScreens['calendar-agent-invites']}
      />
      <FeaturePageSection
        id="calendar-booking-links"
        title={sections[2].title}
        description={sections[2].description}
        screen={featureScreens['calendar-booking-links']}
      />
    </>
  );
}
