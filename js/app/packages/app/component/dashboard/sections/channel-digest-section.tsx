import { DashboardSection } from '../dashboard-section';

export function ChannelDigestSection() {
  return (
    <DashboardSection
      title="Channel Digest"
      description="AI-summarized discussions from your channels"
    >
      <ChannelDigestContent />
    </DashboardSection>
  );
}

function ChannelDigestContent() {
  // TODO: Fetch channel digest from AI
  return (
    <ul class="space-y-3">
      <li class="text-sm text-ink-muted">
        No unread channel discussions to summarize.
      </li>
    </ul>
  );
}
