import { featureScreens } from '../core/feature-screens';
import { FeaturePageSection } from './FeaturePage';

/** The Booking links page: guests pick a time, team links, Forms in front, and agent setup. */
export function BookingLinkStories() {
  return (
    <>
      <FeaturePageSection
        id="booking-links-guests"
        title="Let guests choose a time to meet."
        description="Guests see your available times in their own time zone and book without a Macro account. The meeting appears in Macro Calendar, and everyone gets an invitation."
        screen={featureScreens['booking-links-guests']}
      />

      <FeaturePageSection
        id="booking-links-team"
        title="Book one teammate or the whole team."
        description="Book everyone together, or use round robin to find one available teammate. Macro checks each host’s calendar and working hours before offering a time."
        screen={featureScreens['booking-links-team']}
      />

      <FeaturePageSection
        id="booking-links-forms"
        title="Qualify guests first with Macro Forms."
        description="Put a form in front of the link. Add a gate to qualify requests, and people who pass it choose a time after their response is saved. Their answers land in a database, so you know who you’re meeting before the call."
        screen={featureScreens['booking-links-forms']}
      />

      <FeaturePageSection
        id="booking-links-agent"
        title="Ask Macro Agents to create a booking link."
        description="Describe the meeting, hosts, and availability you want. Your agent prepares the link and shows you the details for approval before saving."
        screen={featureScreens['booking-links-agent']}
      />
    </>
  );
}
