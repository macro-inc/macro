import { ActivitySummarySection } from './sections/activity-summary-section';
import { ChannelDigestSection } from './sections/channel-digest-section';
import { DocumentHighlightsSection } from './sections/document-highlights-section';
import { InboxIntelligenceSection } from './sections/inbox-intelligence-section';
import { TaskForecastSection } from './sections/task-forecast-section';
import { TeamPulseSection } from './sections/team-pulse-section';

export function Dashboard() {
  return (
    <main class="h-full overflow-y-auto">
      <div class="max-w-5xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        <header class="mb-6">
          <h1 class="text-xl font-semibold text-ink">Dashboard</h1>
          <p class="text-sm text-ink-muted mt-1">
            Your AI-powered workspace overview
          </p>
        </header>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ActivitySummarySection />
          <InboxIntelligenceSection />
          <TaskForecastSection />
          <TeamPulseSection />
          <DocumentHighlightsSection />
          <ChannelDigestSection />
        </div>
      </div>
    </main>
  );
}
