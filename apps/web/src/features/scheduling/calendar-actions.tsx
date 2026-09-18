import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { writeClipboardData } from '@core/util/dataTransfer';
import { getWebOrigin } from '@core/util/webOrigin';
import GearIcon from '@phosphor/gear.svg';
import LinkIcon from '@phosphor/link.svg';
import { Button } from '@ui';
import { Suspense } from 'solid-js';
import { createSchedulingSource } from './queries/source';

function Actions() {
  const user = useUserId();
  const settings = useSettingsState();
  const source = createSchedulingSource(() => ({
    id: user() ?? 'me',
    name: 'Personal',
    canEdit: true,
  }));
  const copy = async () => {
    const profile = source.profile();
    if (!profile?.revision || !profile.eventTypes.some((e) => e.enabled)) {
      settings.openSettings('Calendar');
      return;
    }
    if (
      await writeClipboardData({
        'text/plain': `${getWebOrigin()}/app/book/${encodeURIComponent(profile.id)}`,
      })
    )
      toast.success('Booking link copied');
    else toast.failure('Could not copy booking link');
  };
  return (
    <div class="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        label="Copy booking link"
        disabled={source.loading()}
        onClick={() => void copy()}
      >
        <LinkIcon class="size-3.5" />
        <span class="hidden lg:inline">Booking link</span>
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        label="Open calendar scheduling settings"
        onClick={() => settings.openSettings('Calendar')}
      >
        <GearIcon class="size-3.5" />
      </Button>
    </div>
  );
}
export function CalendarSchedulingActions() {
  return (
    <Suspense>
      <Actions />
    </Suspense>
  );
}
