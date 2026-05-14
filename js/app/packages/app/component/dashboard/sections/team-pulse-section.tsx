import { DashboardSection } from '../dashboard-section';

export function TeamPulseSection() {
  return (
    <DashboardSection
      title="Team Pulse"
      description="AI summary of team activity and blockers"
    >
      <TeamPulseContent />
    </DashboardSection>
  );
}

function TeamPulseContent() {
  // TODO: Fetch team pulse from AI
  return (
    <div class="space-y-3">
      <section aria-labelledby="active-now">
        <h3 id="active-now" class="text-xs font-medium text-ink-muted mb-2">
          Active Now
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No team members online</li>
        </ul>
      </section>
      <section aria-labelledby="recent-activity">
        <h3 id="recent-activity" class="text-xs font-medium text-ink-muted mb-2">
          Recent Activity
        </h3>
        <p class="text-sm text-ink-muted">
          Team activity summary will appear here.
        </p>
      </section>
    </div>
  );
}
