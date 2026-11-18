import { t } from '@app/lib/i18n';
import {
  ActionDialogShell,
  Button,
  Dialog,
  type ManagedDialogProps,
  type OpenDialogOptions,
  openDialog,
  RadioGroup,
} from '@ui';
import { createSignal, For, type JSX, Show } from 'solid-js';
import type {
  ScreenCaptureSource,
  ScreenCaptureSources,
} from './desktop-screen-capture';

type ScreenSourcePickerProps = ManagedDialogProps & {
  sources: ScreenCaptureSources;
  onPick: (source: ScreenCaptureSource) => void;
};

type SourceRow = {
  source: ScreenCaptureSource;
  label: string;
  detail?: string;
};

function screenRows(sources: ScreenCaptureSource[]): SourceRow[] {
  let external = 0;
  return sources
    .filter((source) => source.kind === 'screen')
    .map((source) => {
      if (source.builtin) {
        return { source, label: t('calls.builtInDisplay') };
      }
      external += 1;
      return { source, label: t('calls.display', { number: external }) };
    });
}

function windowRows(sources: ScreenCaptureSource[]): SourceRow[] {
  return sources
    .filter((source) => source.kind === 'window')
    .map((source) => ({
      source,
      label: source.name ?? source.appName ?? '',
      detail: source.name ? (source.appName ?? undefined) : undefined,
    }));
}

function SourceSection(props: { title: string; children: JSX.Element }) {
  return (
    <div role="group" aria-label={props.title} class="flex flex-col gap-1">
      <div class="text-xs font-medium text-ink-muted">{props.title}</div>
      {props.children}
    </div>
  );
}

function SourceItem(props: { row: SourceRow }) {
  return (
    <RadioGroup.Item
      value={props.row.source.id}
      class="min-w-0 rounded-lg px-2 py-1.5 not-touch:hover:bg-hover touch:min-h-[44px]"
    >
      <RadioGroup.ItemControl />
      <div class="flex min-w-0 flex-col">
        <RadioGroup.ItemLabel class="truncate text-sm text-ink">
          {props.row.label}
        </RadioGroup.ItemLabel>
        <Show when={props.row.detail}>
          {(detail) => (
            <RadioGroup.ItemDescription class="truncate text-xs text-ink-muted">
              {detail()}
            </RadioGroup.ItemDescription>
          )}
        </Show>
      </div>
    </RadioGroup.Item>
  );
}

function ScreenSourcePicker(props: ScreenSourcePickerProps) {
  const screens = () => screenRows(props.sources.sources);
  const windows = () => windowRows(props.sources.sources);
  const [selected, setSelected] = createSignal(
    props.sources.sources[0]?.id ?? ''
  );

  const share = (event: Event) => {
    event.preventDefault();
    const source = props.sources.sources.find((s) => s.id === selected());
    if (source) props.onPick(source);
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-[90%] max-w-110"
      visibleScrim
    >
      <form onSubmit={share}>
        <ActionDialogShell>
          <ActionDialogShell.Body class="space-y-4">
            <ActionDialogShell.Header>
              <ActionDialogShell.Title>
                {t('calls.shareScreenTitle')}
              </ActionDialogShell.Title>
              <ActionDialogShell.Description>
                {t('calls.shareScreenDescription')}
              </ActionDialogShell.Description>
            </ActionDialogShell.Header>
            <Show when={!props.sources.hasAccess}>
              <p role="alert" class="text-sm text-ink-muted">
                {t('calls.screenAccessNeeded')}
              </p>
            </Show>
            <RadioGroup
              value={selected()}
              onChange={setSelected}
              aria-label={t('calls.shareScreenTitle')}
              class="gap-4"
            >
              <SourceSection title={t('calls.screens')}>
                <For each={screens()}>{(row) => <SourceItem row={row} />}</For>
              </SourceSection>
              <SourceSection title={t('calls.windows')}>
                <For
                  each={windows()}
                  fallback={
                    <p class="px-2 text-sm text-ink-muted">
                      {t('calls.noWindows')}
                    </p>
                  }
                >
                  {(row) => <SourceItem row={row} />}
                </For>
              </SourceSection>
            </RadioGroup>
          </ActionDialogShell.Body>
          <ActionDialogShell.Footer>
            <Button
              type="button"
              variant="ghost"
              onClick={() => props.onOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={!selected()}>
              {t('calls.share')}
            </Button>
          </ActionDialogShell.Footer>
        </ActionDialogShell>
      </form>
    </Dialog>
  );
}

/**
 * Asks which screen or window to share. Resolves with the chosen source, or
 * `undefined` when dismissed.
 */
export async function pickScreenSource(
  sources: ScreenCaptureSources,
  options?: OpenDialogOptions
): Promise<ScreenCaptureSource | undefined> {
  let picked: ScreenCaptureSource | undefined;

  const handle = openDialog(
    (managed: ManagedDialogProps & { sources: ScreenCaptureSources }) => (
      <ScreenSourcePicker
        {...managed}
        onPick={(source) => {
          picked = source;
          managed.onOpenChange(false);
        }}
      />
    ),
    { sources },
    options
  );

  await handle.closed;
  return picked;
}
