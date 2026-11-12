import { For } from 'solid-js';
import { FeaturePageSection } from './FeaturePage';
import './booking-link-stories.css';

/** Illustrative booking states; the working scheduler lives in the app. */
export function BookingLinkStories() {
  return (
    <div class="booking-link-stories">
      <FeaturePageSection
        id="booking-links-guests"
        title="Let guests choose a time to meet."
        description="Guests see your available times in their own time zone and book without a Macro account. The meeting appears in Macro Calendar, and everyone gets an invitation."
        demo={{
          tone: 'calls',
          message: {
            person: 'julia',
            text: 'Here’s our demo link. Pick a time that works for you.',
          },
        }}
      >
        <div
          class="booking-story-card glass"
          role="img"
          aria-label="Example guest booking page for a 30-minute Macro demo, with available dates and times."
        >
          <div class="booking-story-topline">
            MACRO <span>Booking preview</span>
          </div>
          <div class="booking-story-guest">
            <div class="booking-story-meeting">
              <span class="booking-story-kicker">Meet the team</span>
              <h3>Macro demo</h3>
              <p>30 minutes · Video call</p>
              <p>Tell us what you’re working on. We’ll show you around.</p>
              <span class="booking-story-zone">America / New York</span>
            </div>
            <div class="booking-story-calendar">
              <h4>November 2026</h4>
              <div class="booking-story-days">
                <For each={['S', 'M', 'T', 'W', 'T', 'F', 'S']}>
                  {(day) => <span class="booking-story-weekday">{day}</span>}
                </For>
                <For each={Array.from({ length: 30 }, (_, i) => i + 1)}>
                  {(day) => (
                    <span
                      classList={{
                        'is-selected': day === 5,
                        'is-available': [6, 9, 10, 11, 12, 13].includes(day),
                      }}
                    >
                      {day}
                    </span>
                  )}
                </For>
              </div>
              <div class="booking-story-times">
                <span>11:00 AM</span>
                <span>11:30 AM</span>
                <span>1:00 PM</span>
              </div>
            </div>
          </div>
        </div>
      </FeaturePageSection>

      <FeaturePageSection
        id="booking-links-team"
        title="Book one teammate or the whole team."
        description="Book everyone together, or use round robin to find one available teammate. Macro checks each host’s calendar and working hours before offering a time."
        demo={{
          tone: 'calls',
          message: {
            person: 'julia',
            text: 'Use the team link. It will find an available host.',
          },
        }}
      >
        <div
          class="booking-story-card glass"
          role="img"
          aria-label="Example team booking settings: round robin, Monday through Friday hours, a 15-minute buffer, four hours’ notice, and four meetings per day."
        >
          <div class="booking-story-topline">
            Team demo <span>Booking settings</span>
          </div>
          <h3>Leave room for the work.</h3>
          <div class="booking-story-modes">
            <span>All hosts together</span>
            <span class="is-selected">Round robin</span>
          </div>
          <dl class="booking-story-settings">
            <div>
              <dt>Working hours</dt>
              <dd>Mon–Fri, 9 AM–5 PM</dd>
            </div>
            <div>
              <dt>Time between meetings</dt>
              <dd>15 minutes</dd>
            </div>
            <div>
              <dt>Minimum notice</dt>
              <dd>4 hours</dd>
            </div>
            <div>
              <dt>Daily booking limit</dt>
              <dd>4 meetings</dd>
            </div>
          </dl>
          <p class="booking-story-note">
            Busy times stay off the booking page.
          </p>
        </div>
      </FeaturePageSection>

      <FeaturePageSection
        id="booking-links-agent"
        title="Ask an agent to create a booking link."
        description="Describe the meeting, hosts, and availability you want. Your agent prepares the link and shows you the details for approval before saving."
        demo={{
          tone: 'calls',
          message: {
            person: 'julia',
            text: 'Make a 30-minute team demo link. Round robin, with 15 minutes between calls.',
          },
        }}
      >
        <div
          class="booking-story-card glass"
          role="img"
          aria-label="Example agent review of a team demo booking link, waiting for approval before saving."
        >
          <div class="booking-story-topline">
            Create booking link <span>Review</span>
          </div>
          <h3>Team demo</h3>
          <dl class="booking-story-settings">
            <div>
              <dt>Duration</dt>
              <dd>30 minutes</dd>
            </div>
            <div>
              <dt>Hosts</dt>
              <dd>Julia and Jacob · Round robin</dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>Each host’s working hours</dd>
            </div>
            <div>
              <dt>Buffer</dt>
              <dd>15 minutes</dd>
            </div>
          </dl>
          <p class="booking-story-approval">Waiting for your approval</p>
          <p class="booking-story-note">
            New links start paused. Turn on Accept bookings when you’re ready.
          </p>
        </div>
      </FeaturePageSection>
    </div>
  );
}
