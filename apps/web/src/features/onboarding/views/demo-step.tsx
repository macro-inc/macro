import { createSignal, type JSX, Show } from 'solid-js';
import { ContinueButton, SkipButton } from '../components/controls';
import { useOnboardingContext } from '../context/onboarding-context';

/** The host's booking picker for the demo call. */
export type DemoBookingSlot = (actions: {
  guestEmail: string | undefined;
  /** `startsAt` is the booked call's ISO start time. */
  onBooked: (startsAt: string) => void;
}) => JSX.Element;

/** Optional last step for a paid team owner: book a demo call with Macro. */
export function DemoStep(props: {
  finishing: boolean;
  renderBooking: DemoBookingSlot;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const [bookedAt, setBookedAt] = createSignal<string>();
  const guestEmail = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' ? viewer.viewer.email : undefined;
  };
  const bookedLabel = (startsAt: string) =>
    new Date(startsAt).toLocaleString([], {
      dateStyle: 'full',
      timeStyle: 'short',
    });

  return (
    <section class="mx-auto flex w-full max-w-4xl flex-col py-2 sm:py-4">
      <header class="text-center">
        <h1
          tabindex="-1"
          class="font-[Roboto_Slab_Variable] text-[clamp(1.75rem,8vw,3rem)] font-[315] leading-[1.12] tracking-tight outline-none text-balance"
        >
          {bookedAt() ? "You're booked." : 'Book a demo with our team.'}
        </h1>
        <p class="mx-auto mt-6 max-w-[440px] text-sm leading-6 text-ink-muted text-balance sm:text-[15px]">
          <Show
            when={bookedAt()}
            fallback="We'll walk your team through Macro and help set up your workspace. This step is optional."
          >
            {(startsAt) =>
              `See you ${bookedLabel(startsAt())}. The invite is on its way to your inbox.`
            }
          </Show>
        </p>
      </header>
      <Show
        when={bookedAt()}
        fallback={
          <>
            <div class="mt-9 w-full">
              {props.renderBooking({
                guestEmail: guestEmail(),
                onBooked: setBookedAt,
              })}
            </div>
            <div class="mt-6 flex justify-center">
              <SkipButton
                label={
                  props.finishing ? 'Opening your workspace…' : 'Skip for now'
                }
                disabled={props.finishing}
                onClick={props.onSkip}
              />
            </div>
          </>
        }
      >
        <div class="mt-9">
          <ContinueButton
            label={
              props.finishing
                ? 'Opening your workspace…'
                : 'Continue to workspace'
            }
            disabled={props.finishing}
            onClick={props.onContinue}
          />
        </div>
      </Show>
    </section>
  );
}
