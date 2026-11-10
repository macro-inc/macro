import OutlookIcon from '@assets/icons/logo-outlook.svg';
import GoogleIcon from '@icon/macro-google.svg';
import MacroIcon from '@icon/macro-logo.svg';
import CalendarIcon from '@icon/system/regular/calendar.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import { For } from 'solid-js';
import { workspaceFeatures } from '../core/workspace-features';
import { FeatureDemoBackdrop } from './FeatureDemoBackdrop';
import { FeaturePageSection } from './FeaturePage';
import './calendar-stories.css';

/** Illustrative calendar states, with no changes to real accounts or events. */
export function CalendarStories() {
  const calendar = workspaceFeatures.calendar;
  return (
    <div class="calendar-stories">
      <FeaturePageSection
        id="calendar-workspace"
        title={calendar.heading}
        description={calendar.detail}
      >
        <div
          class="calendar-story"
          role="img"
          aria-label="Google and Microsoft accounts shown together in one calendar, with color-coded work and personal events."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-story-accounts calendar-story-glass">
            <div class="calendar-story-label">Your calendars</div>
            <div class="calendar-story-account">
              <GoogleIcon />
              <span>julia@macro.com</span>
              <CheckIcon />
            </div>
            <div class="calendar-story-account">
              <OutlookIcon />
              <span>julia@outlook.com</span>
              <CheckIcon />
            </div>
            <div class="calendar-story-account">
              <GoogleIcon />
              <span>julia@gmail.com</span>
              <CheckIcon />
            </div>
          </div>
          <div class="calendar-story-week calendar-story-glass">
            <div class="calendar-story-label">
              <CalendarIcon /> November 9–11
            </div>
            <div class="calendar-story-days">
              <For each={['Mon 9', 'Tue 10', 'Wed 11']}>
                {(day) => <span>{day}</span>}
              </For>
              <span class="calendar-story-event" data-tone="blue">
                Team standup<small>9–9:30 AM</small>
              </span>
              <span class="calendar-story-event" data-tone="purple">
                Design review<small>9–10 AM</small>
              </span>
              <span class="calendar-story-event" data-tone="blue">
                Customer demo<small>9–10 AM</small>
              </span>
              <span class="calendar-story-event" data-tone="purple">
                Project review<small>11 AM–12 PM</small>
              </span>
              <span class="calendar-story-event" data-tone="green">
                Lunch with Sam<small>12–1 PM</small>
              </span>
              <span class="calendar-story-event" data-tone="green">
                Dentist<small>1–2 PM</small>
              </span>
            </div>
          </div>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="calendar-team-availability"
        title={calendar.sections![0].title}
        description={calendar.sections![0].description}
      >
        <div
          class="calendar-story calendar-story-team"
          role="img"
          aria-label="In the design channel, Julia asks Macro for a time with Teo and Priya. Macro finds Tuesday at 2 PM. Calendar settings share busy blocks with teammates and count the selected calendars as busy."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-story-conversation calendar-story-glass">
            <div class="calendar-story-label"># design</div>
            <div class="calendar-story-message">
              <span class="calendar-story-avatar">J</span>
              <div>
                <strong>Julia</strong>
                <p>
                  <span class="calendar-story-mention">@Macro</span> find 30
                  minutes with Teo and Priya this week.
                </p>
              </div>
            </div>
            <div class="calendar-story-message">
              <span class="calendar-story-avatar">
                <MacroIcon />
              </span>
              <div>
                <strong>
                  Macro <small>Agent</small>
                </strong>
                <p>Tuesday at 2 PM is free for everyone.</p>
                <div class="calendar-story-slot">
                  <CalendarIcon /> Tue, Nov 10 · 2–2:30 PM
                </div>
              </div>
            </div>
          </div>
          <div class="calendar-story-settings calendar-story-glass">
            <div class="calendar-story-label">Settings / Calendar</div>
            <strong>Team sharing</strong>
            <div class="calendar-story-setting">
              <span>Share with teammates</span>
              <span class="calendar-story-choice">Busy blocks⌄</span>
            </div>
            <p class="calendar-story-muted">
              Teammates see when you are busy, not what.
            </p>
            <strong>Calendars that count as busy</strong>
            <div class="calendar-story-setting">
              <span>Work calendar</span>
              <span class="calendar-story-toggle">
                <i />
              </span>
            </div>
            <div class="calendar-story-setting">
              <span>Personal calendar</span>
              <span class="calendar-story-toggle">
                <i />
              </span>
            </div>
          </div>
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="calendar-agent-invites"
        title={calendar.sections![1].title}
        description={calendar.sections![1].description}
      >
        <div
          class="calendar-story calendar-story-invites"
          role="img"
          aria-label="Julia asks Macro to move design review to Tuesday at 2 PM and add Priya. An event preview shows the revised time and guest list for review before updating the event."
        >
          <FeatureDemoBackdrop />
          <div class="calendar-story-request calendar-story-glass">
            <span class="calendar-story-mention">@Macro</span> move design
            review to Tuesday at 2 PM and add Priya.
          </div>
          <div class="calendar-story-invite calendar-story-glass">
            <div class="calendar-story-label">
              <CalendarIcon /> Update event <span>Review</span>
            </div>
            <h3>Design review</h3>
            <dl>
              <div>
                <dt>When</dt>
                <dd>Tue, Nov 10 · 2–2:30 PM</dd>
              </div>
              <div>
                <dt>Guests</dt>
                <dd>Julia, Teo, Priya</dd>
              </div>
              <div>
                <dt>Calendar</dt>
                <dd>julia@macro.com</dd>
              </div>
            </dl>
            <span class="calendar-story-confirm">Confirm update</span>
          </div>
        </div>
      </FeaturePageSection>
    </div>
  );
}
