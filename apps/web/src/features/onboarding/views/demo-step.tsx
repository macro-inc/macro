import { createSignal, type JSX, Match, Show, Switch } from 'solid-js';
import {
  ContinueButton,
  SecondaryButton,
  SkipButton,
} from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';

/** The host's booking picker for the walkthrough call. */
export type DemoBookingSlot = (actions: {
  guestEmail: string | undefined;
  /** `startsAt` is the booked call's ISO start time. */
  onBooked: (startsAt: string) => void;
}) => JSX.Element;

type DemoStage =
  | { t: 'offer' }
  | { t: 'calendar' }
  | { t: 'booked'; startsAt: string };

/**
 * Optional last step for a paid team owner: offer a live walkthrough, then
 * book it on the calendar.
 */
export function DemoStep(props: {
  finishing: boolean;
  renderBooking: DemoBookingSlot;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const [stage, setStage] = createSignal<DemoStage>({ t: 'offer' });
  const guestEmail = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' ? viewer.viewer.email : undefined;
  };
  const booked = () => {
    const current = stage();
    return current.t === 'booked' ? current.startsAt : undefined;
  };
  const bookedLabel = (startsAt: string) =>
    new Date(startsAt).toLocaleString([], {
      dateStyle: 'full',
      timeStyle: 'short',
    });
  const opening = 'Opening your workspace…';

  return (
    <section class="mx-auto flex w-full max-w-4xl flex-col py-2 sm:py-4">
      <header class="text-center">
        <Show when={stage().t === 'offer'}>
          <p class="mb-4 text-xs font-medium uppercase tracking-[0.14em] text-ink-muted">
            One last thing
          </p>
        </Show>
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          <Switch>
            <Match when={stage().t === 'offer'}>Want a live walkthrough?</Match>
            <Match when={stage().t === 'calendar'}>Pick a time.</Match>
            <Match when={booked()}>You're booked.</Match>
          </Switch>
        </h1>
        <p class="mx-auto mt-6 max-w-[440px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          <Switch>
            <Match when={stage().t === 'offer'}>
              Thanks for starting a trial — we'd love to give you a live
              walkthrough for you and your team!
            </Match>
            <Match when={stage().t === 'calendar'}>
              Choose a time that works for you and your team.
            </Match>
            <Match when={booked()}>
              {(startsAt) =>
                `See you ${bookedLabel(startsAt())}. The invite is on its way to your inbox.`
              }
            </Match>
          </Switch>
        </p>
      </header>
      <Switch>
        <Match when={stage().t === 'offer'}>
          <div class="mt-9">
            <ContinueButton
              label={props.finishing ? opening : 'Book now'}
              disabled={props.finishing}
              onClick={() => setStage({ t: 'calendar' })}
              secondary={
                <SecondaryButton
                  label="Skip"
                  disabled={props.finishing}
                  onClick={props.onSkip}
                />
              }
            />
          </div>
        </Match>
        <Match when={stage().t === 'calendar'}>
          <div class="mt-9 w-full">
            {props.renderBooking({
              guestEmail: guestEmail(),
              onBooked: (startsAt) => setStage({ t: 'booked', startsAt }),
            })}
          </div>
          <div class="mt-6 flex justify-center">
            <SkipButton
              label={props.finishing ? opening : 'Skip'}
              disabled={props.finishing}
              onClick={props.onSkip}
            />
          </div>
        </Match>
        <Match when={booked()}>
          <div class="mt-9">
            <ContinueButton
              label={props.finishing ? opening : 'Continue to workspace'}
              disabled={props.finishing}
              onClick={props.onContinue}
            />
          </div>
        </Match>
      </Switch>
    </section>
  );
}
