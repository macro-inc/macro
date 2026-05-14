import { DashboardSection } from '../dashboard-section';

export function DocumentHighlightsSection() {
  return (
    <DashboardSection
      title="Document Highlights"
      description="AI summary of recent document changes"
    >
      <DocumentHighlightsContent />
    </DashboardSection>
  );
}

function DocumentHighlightsContent() {
  // TODO: Fetch document highlights from AI
  return (
    <ul class="space-y-2">
      <li class="text-sm text-ink-muted">
        No recent document changes to highlight.
      </li>
    </ul>
  );
}
