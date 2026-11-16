import CalendarIcon from '@icon/system/regular/calendar.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { FeatureDemoBackdrop } from '../FeatureDemoBackdrop';
import './form-stories.css';

/** A form's qualifying gate followed by its booking step. */
export function FormBookingGraphic() {
  return (
    <div
      class="forms-story forms-story-booking"
      role="img"
      aria-label="A form gate lets teams of at least five continue. After submitting, respondents can book a 30-minute product demo."
    >
      <FeatureDemoBackdrop />
      <div class="forms-card forms-gate-card">
        <div class="forms-card-label">
          <CheckIcon /> Continue when
        </div>
        <div class="forms-rule">
          <span>Team size</span>
          <span>is at least</span>
          <strong>5</strong>
        </div>
        <p>People who meet this condition continue to booking.</p>
      </div>
      <div class="forms-card forms-booking-card">
        <div class="forms-card-label">
          <LinkIcon /> Booking · Last step
        </div>
        <h3>Product demo</h3>
        <p>
          <CalendarIcon /> 30 minutes · Your local time
        </p>
        <div class="forms-times">
          <span>10:00 AM</span>
          <span>11:30 AM</span>
          <span>2:00 PM</span>
        </div>
        <span class="forms-submit">Choose a time</span>
      </div>
    </div>
  );
}
