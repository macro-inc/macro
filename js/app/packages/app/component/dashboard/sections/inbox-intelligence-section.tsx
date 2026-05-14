import { DashboardSection } from '../dashboard-section';

export function InboxIntelligenceSection() {
  return (
    <DashboardSection
      title="Inbox Intelligence"
      description="AI triage of your inbox by urgency and topic"
    >
      <InboxIntelligenceContent />
    </DashboardSection>
  );
}

function InboxIntelligenceContent() {
  // TODO: Fetch inbox intelligence from AI
  return (
    <div class="space-y-3">
      <section aria-labelledby="needs-attention">
        <h3 id="needs-attention" class="text-xs font-medium text-ink-muted mb-2">
          Needs Attention
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No urgent items</li>
        </ul>
      </section>
      <section aria-labelledby="can-wait">
        <h3 id="can-wait" class="text-xs font-medium text-ink-muted mb-2">
          Can Wait
        </h3>
        <ul class="space-y-1">
          <li class="text-sm text-ink-muted">No items</li>
        </ul>
      </section>
    </div>
  );
}
