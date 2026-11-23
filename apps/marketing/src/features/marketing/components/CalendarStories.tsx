import { For } from 'solid-js';
import { featureScreens } from '../core/feature-screens';
import { workspaceFeatures } from '../core/workspace-features';
import { FeaturePageSection } from './FeaturePage';

/** The Calendar page: accounts in one view, finding a time, agent invites, and booking links. */
export function CalendarStories() {
  const calendar = workspaceFeatures.calendar;
  const sections = (calendar.sections ?? []).flatMap((section) =>
    section.id ? [{ ...section, id: section.id }] : []
  );
  return (
    <>
      <FeaturePageSection
        id="calendar-workspace"
        title={calendar.heading}
        description={calendar.detail}
        screen={featureScreens['calendar-workspace']}
      />
      <For each={sections}>
        {(section) => (
          <FeaturePageSection
            id={section.id}
            title={section.title}
            description={section.description}
            screen={featureScreens[section.id]}
          />
        )}
      </For>
    </>
  );
}
