import pairingExampleUrl from '../assets/macrod-pairing-example.png';

/** Shows where macrod displays a device code, without supplying a real code. */
export function MacrodPairingExample() {
  return (
    <figure class="flex flex-col gap-3">
      <figcaption class="px-1 text-sm text-ink-muted">
        Example only—enter the code from your own macrod terminal.
      </figcaption>
      <a
        href={pairingExampleUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Open the example macrod pairing screen at full size"
        class="block overflow-hidden rounded-xl border border-edge-muted focus-visible:outline-accent"
      >
        <img
          src={pairingExampleUrl}
          alt="Example macrod terminal with the device code in the Pair macrod panel. Press p to pair and c to copy your code."
          width={1552}
          height={1463}
          class="h-auto w-full"
        />
      </a>
    </figure>
  );
}
