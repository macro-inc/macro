import { SettingsCard, SettingsPage, SettingsSection } from '../primitives';

export function ConnectionsCardSkeleton(props: { label?: string }) {
  return (
    <div
      class="flex flex-col"
      role="status"
      aria-label={props.label ?? 'Loading'}
    >
      <div class="flex items-start gap-4 px-6 py-5">
        <div class="skeleton-shimmer size-9 shrink-0 rounded-lg bg-skeleton" />
        <div class="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
          <div class="skeleton-shimmer h-4 w-24 rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-3 w-full rounded-full bg-skeleton" />
          <div class="skeleton-shimmer h-3 w-4/5 rounded-full bg-skeleton" />
        </div>
      </div>
      <div class="flex flex-col gap-2 px-6 py-3.5">
        <div class="skeleton-shimmer h-4 w-32 rounded-full bg-skeleton" />
        <div class="skeleton-shimmer h-3 w-3/4 rounded-full bg-skeleton" />
        <div class="skeleton-shimmer mt-1 h-9 w-full rounded-lg bg-skeleton" />
      </div>
    </div>
  );
}

export function ConnectionsPageSkeleton(props: {
  title?: string;
  description?: string;
  onBack?: () => void;
  backLabel?: string;
}) {
  return (
    <SettingsPage
      title={props.title ?? 'Connections'}
      description={
        props.description ??
        'Link your inbox, GitHub, Linear, Notion, and more.'
      }
      onBack={props.onBack}
      backLabel={props.backLabel}
    >
      <SettingsSection title="Your Connections">
        <SettingsCard>
          <ConnectionsCardSkeleton label="Loading Connections" />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  );
}
