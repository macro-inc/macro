import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowRightIcon from '@icon/system/regular/arrow-right.svg';
import HashIcon from '@icon/system/regular/hash.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { Button, Checkbox, Dialog, Spinner, Surface } from '@ui';
import { createEffect, createSignal, For, on, Show, untrack } from 'solid-js';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import type { OrganizeSuggestion } from '../core/jev-triage';

export type SmartOrganizeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SmartOrganizeDialog(props: SmartOrganizeDialogProps) {
  const ws = useSidebarWorkspace();
  const [analyzing, setAnalyzing] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<OrganizeSuggestion[]>([]);
  const [selectedIds, setSelectedIds] = createSignal<Set<string>>(new Set());
  const [costNote, setCostNote] = createSignal('');
  const [error, setError] = createSignal('');
  let runGeneration = 0;

  createEffect(
    on(
      () => props.open,
      (open) => {
        const gen = ++runGeneration;
        if (!open) {
          setAnalyzing(false);
          return;
        }
        setAnalyzing(true);
        setError('');
        setCostNote('');
        setSuggestions([]);
        setSelectedIds(new Set<string>());

        const ungrouped = untrack(() => ws.placement().ungroupedChannels);
        const sections = untrack(() => ws.sections());

        fireAndForget(
          ws.triage
            .suggestOrganization(ungrouped, sections)
            .then((result) => {
              if (gen !== runGeneration || !props.open) return;
              setSuggestions(result.suggestions);
              setSelectedIds(
                new Set(result.suggestions.map((item) => item.channelId))
              );
              if (result.usedJevCount > 0) {
                setCostNote(
                  t('channelSidebar.organizeJevCostNote', {
                    count: result.usedJevCount,
                    cost: result.estimatedCostFormatted,
                  })
                );
              }
            })
            .catch(() => {
              if (gen !== runGeneration || !props.open) return;
              setError(t('channelSidebar.organizeFailed'));
            })
            .finally(() => {
              if (gen !== runGeneration) return;
              setAnalyzing(false);
            }),
          'channels-jev'
        );
      }
    )
  );

  const toggleItem = (channelId: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(channelId);
      else next.delete(channelId);
      return next;
    });
  };

  const chosenSuggestions = () => {
    const selected = selectedIds();
    return suggestions().filter((item) => selected.has(item.channelId));
  };

  const applySelected = async () => {
    const chosen = chosenSuggestions();
    if (applying() || chosen.length === 0) return;

    setApplying(true);
    setError('');

    try {
      // Group proposed new sections so we create each proposed section once.
      const createdByProposedName = new Map<string, string>();
      const succeededIds = new Set<string>();
      let failedCount = 0;

      for (const item of chosen) {
        try {
          if (item.target.kind === 'existing') {
            const ok = await ws.assignChannelToSection(
              item.channelId,
              item.target.sectionId
            );
            if (ok === false) {
              failedCount += 1;
            } else {
              succeededIds.add(item.channelId);
            }
          } else {
            const proposedName = item.target.sectionName;
            let sectionId = createdByProposedName.get(proposedName);
            if (!sectionId) {
              sectionId = await ws.createSection({
                scope: 'personal',
                name: proposedName,
                channelIds: [item.channelId],
              });
              if (sectionId) {
                createdByProposedName.set(proposedName, sectionId);
                succeededIds.add(item.channelId);
              } else {
                failedCount += 1;
              }
            } else {
              const ok = await ws.assignChannelToSection(
                item.channelId,
                sectionId
              );
              if (ok === false) {
                failedCount += 1;
              } else {
                succeededIds.add(item.channelId);
              }
            }
          }
        } catch {
          failedCount += 1;
        }
      }

      if (succeededIds.size > 0) {
        toast.success(
          t('channelSidebar.organizeApplied', { count: succeededIds.size })
        );
      }

      if (failedCount > 0) {
        setSuggestions((prev) =>
          prev
            .filter((item) => !succeededIds.has(item.channelId))
            .map((item) => {
              if (item.target.kind === 'proposed') {
                const createdId = createdByProposedName.get(
                  item.target.sectionName
                );
                if (createdId) {
                  return {
                    ...item,
                    target: {
                      kind: 'existing' as const,
                      sectionId: createdId,
                      sectionName: item.target.sectionName,
                    },
                  };
                }
              }
              return item;
            })
        );
        setSelectedIds((prev) => {
          const next = new Set(prev);
          for (const id of succeededIds) next.delete(id);
          return next;
        });
        setError(t('channelSidebar.organizeFailed'));
      } else {
        props.onOpenChange(false);
      }
    } finally {
      setApplying(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!applying()) props.onOpenChange(open);
      }}
      class="w-[min(34rem,92vw)]"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[min(34rem,78dvh)] flex-col overflow-hidden rounded-xl border border-edge text-ink shadow-xl"
        data-smart-organize-dialog=""
      >
        <div class="flex flex-col gap-1 border-b border-edge-muted px-5 py-4">
          <div class="flex items-center gap-2">
            <SparkleIcon class="size-4 text-accent" />
            <Dialog.Title class="text-base font-semibold">
              {t('channelSidebar.organizeTitle')}
            </Dialog.Title>
          </div>
          <Dialog.Description class="text-xs leading-5 text-ink-muted">
            {t('channelSidebar.organizeDescription')}
          </Dialog.Description>
        </div>

        <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-3">
          <Show when={analyzing()}>
            <div class="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
              <Spinner size="sm" />
              <span>{t('channelSidebar.organizeAnalyzing')}</span>
            </div>
          </Show>

          <Show when={!analyzing() && suggestions().length === 0}>
            <div class="py-10 text-center text-sm text-ink-muted">
              {t('channelSidebar.organizeEmpty')}
            </div>
          </Show>

          <Show when={!analyzing() && suggestions().length > 0}>
            <For each={suggestions()}>
              {(item) => {
                const targetLabel = () =>
                  item.target.kind === 'existing'
                    ? t('channelSidebar.organizeExistingSection', {
                        name: item.target.sectionName,
                      })
                    : t('channelSidebar.organizeProposedSection', {
                        name: item.target.sectionName,
                      });
                return (
                  <Checkbox
                    class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 hover:bg-hover"
                    checked={selectedIds().has(item.channelId)}
                    disabled={applying()}
                    onChange={(checked) => toggleItem(item.channelId, checked)}
                  >
                    <Checkbox.Control />
                    <Checkbox.Label class="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <HashIcon class="size-3.5 shrink-0 text-ink-muted" />
                      <span class="min-w-0 truncate font-medium text-ink">
                        {item.channelName}
                      </span>
                      <ArrowRightIcon class="size-3 shrink-0 text-ink-extra-muted" />
                      <span class="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-xs text-ink-muted">
                        {targetLabel()}
                      </span>
                    </Checkbox.Label>
                  </Checkbox>
                );
              }}
            </For>
          </Show>

          <Show when={error()}>
            <p role="alert" class="px-2 pt-2 text-xs text-failure">
              {error()}
            </p>
          </Show>
        </div>

        <div class="flex items-center justify-between gap-3 border-t border-edge-muted px-5 py-3">
          <span class="text-xs text-ink-extra-muted">
            {costNote() ||
              (suggestions().length > 0
                ? t('channelSidebar.jevEngineHeuristic')
                : '')}
          </span>
          <div class="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={applying()}
              onClick={() => props.onOpenChange(false)}
            >
              {t('channelSections.cancel')}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={
                analyzing() || applying() || chosenSuggestions().length === 0
              }
              onClick={() => fireAndForget(applySelected(), 'channels-view')}
            >
              {applying()
                ? t('channelSidebar.organizeApplying')
                : t('channelSidebar.organizeApply', {
                    count: chosenSuggestions().length,
                  })}
            </Button>
          </div>
        </div>
      </Surface>
    </Dialog>
  );
}
