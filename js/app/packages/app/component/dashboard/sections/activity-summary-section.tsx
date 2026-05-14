import { DashboardSection } from '../dashboard-section';

export function ActivitySummarySection() {
  return (
    <DashboardSection
      title="Activity Summary"
      description="AI-generated digest of recent workspace activity"
    >
      <ActivitySummaryContent />
    </DashboardSection>
  );
}

function ActivitySummaryContent() {
  // TODO: Fetch activity summary from AI
  return (
    <article class="prose prose-sm">
      <p class="text-ink-muted text-sm">
        Activity summary will appear here once connected to the AI service.
      </p>
    </article>
  );
}
