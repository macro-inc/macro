import { ListHeaderSearch } from '@app/components/view-shell/ListHeader';
import { ViewCreateButton } from '@app/components/view-shell/ViewCreateButton';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal, type JSX, Show } from 'solid-js';
import { failureMessage } from '../components/failure-message';
import { NewSequenceDialog } from '../components/new-sequence-dialog';
import { SectionHeader } from '../components/section-header';
import { SequenceList } from '../components/sequence-list';
import { useSequences } from '../context/sequences-context';

const SURFACE = 'sequences.list';

export function SequenceListView(props: {
  navigation?: JSX.Element;
  onOpen: (sequenceId: string) => void;
}) {
  const context = useSequences();
  const source = context.createSequenceList();
  const senders = context.createSenders();
  const [search, setSearch] = createSignal('');
  const [creating, setCreating] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const shown = () => {
    const query = search().trim().toLowerCase();
    return source
      .sequences()
      .filter((sequence) => sequence.name.toLowerCase().includes(query));
  };
  const openCreate = () => {
    setError(undefined);
    setCreating(true);
  };
  async function create(name: string) {
    const result = await source.create({
      name,
      footer: '',
      linkId: senders.senders().find((sender) => sender.ready)?.id ?? null,
      steps: [{ delayDays: 0, subject: '', body: '' }],
    });
    if (result.isErr()) {
      setError(failureMessage(result.error));
      return;
    }
    setCreating(false);
    props.onOpen(result.value.id);
  }
  return (
    <>
      <SectionHeader
        title={
          <div class="flex min-w-0 items-center gap-3">
            {props.navigation}
            <h2 class="truncate text-sm font-semibold">
              {t('sequences.title')}
            </h2>
          </div>
        }
        actions={
          <>
            <ViewCreateButton
              aria-label={t('sequences.newSequence')}
              onClick={openCreate}
            />
            <ListHeaderSearch
              label={t('sequences.search')}
              value={search()}
              onValueChange={setSearch}
              registerFocus={() => {}}
            />
          </>
        }
      />
      <div class="min-h-0 flex-1 overflow-y-auto touch:pb-[var(--mobile-content-inset-bottom,0px)]">
        <SequenceList
          sequences={shown()}
          pending={source.pending()}
          failure={source.failure()}
          filtered={!!search().trim()}
          onRetry={() => fireAndForget(source.refresh(), SURFACE)}
          onCreate={openCreate}
          onOpen={props.onOpen}
        />
      </div>
      <Show when={creating()}>
        <NewSequenceDialog
          busy={source.creating()}
          error={error()}
          onClose={() => setCreating(false)}
          onCreate={(name) => fireAndForget(create(name), SURFACE)}
        />
      </Show>
    </>
  );
}
