import { lazyNamed } from '@core/util/lazyNamed';
import { Show, Suspense } from 'solid-js';
import { newChannelModalOpen } from './create-channel-modal-state';

export { openNewChannelModal } from './create-channel-modal-state';

const CreateChannelDialog = lazyNamed(
  () => import('./create-channel-dialog'),
  'CreateChannelDialog'
);

export function CreateChannelModal() {
  return (
    <Show when={newChannelModalOpen()}>
      <Suspense>
        <CreateChannelDialog />
      </Suspense>
    </Show>
  );
}
