import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableSlackArchiveImport } from '@core/constant/featureFlags';
import SlackIcon from '@icon/slack-color.svg';
import { useCurrentTeamQuery, useIsTeamAdmin } from '@queries/team/teams';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { SlackImport } from './slack-import';

export function SlackImportSidebar() {
  const flag = useFeatureFlag(enableSlackArchiveImport);
  const team = useCurrentTeamQuery(() => flag().enabled);
  const isAdmin = useIsTeamAdmin();
  const teamId = () => (team.isSuccess ? team.data?.team.id : undefined);

  return (
    <Show when={flag().enabled && isAdmin() && teamId()}>
      {(id) => (
        <div class="px-(--sidebar-gutter) py-2">
          <SlackImport
            teamId={id()}
            isAdmin={isAdmin()}
            trigger={(onOpen) => (
              <section class="w-full rounded-xl border border-edge-muted bg-control px-2 py-3">
                <div class="flex items-start gap-2.5">
                  <SlackIcon
                    aria-hidden="true"
                    class="mt-0.5 size-4 shrink-0"
                  />
                  <div class="min-w-0">
                    <h2 class="text-xs font-medium text-ink">
                      Bring Slack to Macro
                    </h2>
                    <p class="mt-1 text-xs leading-relaxed text-ink-muted">
                      Bring over channels with or without message history.
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  class="mt-3 w-full"
                  onClick={(event) => onOpen(event.currentTarget)}
                >
                  Import from Slack
                </Button>
              </section>
            )}
          />
        </div>
      )}
    </Show>
  );
}
