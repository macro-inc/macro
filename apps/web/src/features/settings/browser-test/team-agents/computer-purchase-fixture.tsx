import type { ComputerSize } from '@service-auth/computers';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ComputerPurchaseDialog } from '../../computers/components/computer-purchase-dialog';
import { ComputerSizePicker } from '../../computers/components/computer-size-picker';
import { ReleaseComputerDialog } from '../../computers/components/release-computer-dialog';
import { SettingsCard, SettingsPage, SettingsSection } from '../../primitives';
import { COMPUTER_OFFERS } from './computer-catalog';

export function ComputerPurchaseFixture() {
  const [selected, setSelected] = createSignal<ComputerSize>('standard');
  const [review, setReview] = createSignal(false);
  const [releasing, setReleasing] = createSignal(false);
  const [purchases, setPurchases] = createSignal(0);
  const [releases, setReleases] = createSignal(0);
  const included = new URLSearchParams(location.search).has('included');
  const offers = COMPUTER_OFFERS.map((item) =>
    included ? { ...item, quote: { ...item.quote, amount: 0 } } : item
  );
  const offer = () =>
    offers.find((item) => item.size === selected()) ?? COMPUTER_OFFERS[0];
  return (
    <SettingsPage title="Runtimes">
      <SettingsSection title="Get a Macro computer">
        <SettingsCard class="p-4 space-y-4">
          <ComputerSizePicker
            offers={offers}
            selected={selected()}
            onSelect={setSelected}
            onNotify={() => {}}
          />
          <Button onClick={() => setReview(true)}>Continue</Button>
        </SettingsCard>
      </SettingsSection>
      <Button variant="ghost" onClick={() => setReleasing(true)}>
        Release computer
      </Button>
      <p role="status">
        Purchases: {purchases()} · Releases: {releases()}
      </p>
      <Show when={review()}>
        <ComputerPurchaseDialog
          offer={offer()}
          pending={false}
          onClose={() => setReview(false)}
          onConfirm={() => {
            setPurchases((value) => value + 1);
            setReview(false);
          }}
        />
      </Show>
      <Show when={releasing()}>
        <ReleaseComputerDialog
          computerName="Build machine"
          pending={false}
          onClose={() => setReleasing(false)}
          onRelease={() => {
            setReleases((value) => value + 1);
            setReleasing(false);
          }}
        />
      </Show>
    </SettingsPage>
  );
}
