import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableTimeTracking } from '@core/constant/featureFlags';
import { Popover } from '@kobalte/core/popover';
import ClockIcon from '@phosphor/clock.svg';
import { SYSTEM_PROPERTY_IDS } from '@property/identifiers';
import type { Property, PropertyApiValues } from '@property/types';
import {
  useBulkSaveEntityPropertiesMutation,
  useEntityPropertiesQuery,
} from '@queries/properties/entity';
import { Button, Tooltip } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';

type TimeEntryButtonProps = {
  documentId: string;
};

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function parseDuration(input: string): number | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Try hours and minutes format: "1h 30m", "1h30m", "1h", "30m"
  const hMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*h/);
  const mMatch = trimmed.match(/(\d+)\s*m/);

  if (hMatch || mMatch) {
    const hours = hMatch ? parseFloat(hMatch[1]) : 0;
    const mins = mMatch ? parseInt(mMatch[1], 10) : 0;
    return Math.round(hours * 60 + mins);
  }

  // Try decimal hours: "1.5" = 90 minutes
  const decimal = parseFloat(trimmed);
  if (!Number.isNaN(decimal) && decimal >= 0) {
    return Math.round(decimal * 60);
  }

  return null;
}

export function TimeEntryButton(props: TimeEntryButtonProps) {
  const timeTrackingFlag = useFeatureFlag(enableTimeTracking);
  const [open, setOpen] = createSignal(false);
  const [inputValue, setInputValue] = createSignal('');

  const propertiesQuery = useEntityPropertiesQuery(
    () => 'TASK',
    () => props.documentId,
    false
  );

  const saveMutation = useBulkSaveEntityPropertiesMutation();

  const timeProperty = createMemo((): Property | undefined => {
    const properties = propertiesQuery.data ?? [];
    return properties.find(
      (p) => p.propertyDefinitionId === SYSTEM_PROPERTY_IDS.TIME_LOGGED
    );
  });

  const currentMinutes = createMemo(() => {
    const prop = timeProperty();
    if (!prop || prop.valueType !== 'NUMBER') return 0;
    const value = 'value' in prop ? prop.value : null;
    return typeof value === 'number' ? value : 0;
  });

  const handleSave = async () => {
    const parsed = parseDuration(inputValue());
    if (parsed === null) return;

    const newTotal = currentMinutes() + parsed;

    const prop = timeProperty();
    if (!prop) return;

    const apiValues: PropertyApiValues = {
      valueType: 'NUMBER',
      value: newTotal,
    };

    await saveMutation.mutateAsync({
      properties: [
        {
          entityId: props.documentId,
          entityType: 'TASK',
          property: prop,
          apiValues,
        },
      ],
    });

    await propertiesQuery.refetch();
    setInputValue('');
    setOpen(false);
  };

  return (
    <Show when={timeTrackingFlag().enabled}>
      <Popover open={open()} onOpenChange={setOpen}>
        <Tooltip label="Log time">
          <Popover.Trigger
            as={Button}
            variant="ghost"
            size="sm"
            class="relative gap-1.5 px-2"
            aria-label="Log time"
          >
            <ClockIcon class="size-4" />
            <Show when={currentMinutes() > 0}>
              <span class="text-xs text-ink-muted">
                {formatDuration(currentMinutes())}
              </span>
            </Show>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Content class="z-popover w-64 rounded-lg border border-edge bg-panel p-3 shadow-md">
          <div class="space-y-3">
            <div class="text-sm font-medium">Log Time</div>
            <Show when={currentMinutes() > 0}>
              <div class="text-xs text-ink-muted">
                Current: {formatDuration(currentMinutes())}
              </div>
            </Show>
            <input
              type="text"
              value={inputValue()}
              onInput={(e) => setInputValue(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleSave();
                }
              }}
              placeholder="e.g. 1h 30m or 1.5"
              class="w-full rounded-md border border-edge bg-panel px-2.5 py-1.5 text-sm outline-none focus:border-focus focus:ring-1 focus:ring-focus"
            />
            <div class="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                class="flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="cta"
                size="sm"
                class="flex-1"
                onClick={() => void handleSave()}
                disabled={
                  saveMutation.isPending || parseDuration(inputValue()) === null
                }
              >
                {saveMutation.isPending ? 'Saving...' : 'Add'}
              </Button>
            </div>
          </div>
        </Popover.Content>
      </Popover>
    </Show>
  );
}
