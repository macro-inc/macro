import ArrowRightIcon from '@phosphor/arrow-right.svg';
import CalendarIcon from '@phosphor/calendar-dots.svg';
import PlusIcon from '@phosphor/plus.svg';
import UsersIcon from '@phosphor/users.svg';
import XIcon from '@phosphor/x.svg';
import { Button, cn, Layer } from '@ui';
import { createSignal, Index, Show } from 'solid-js';
import { z } from 'zod';
import type { InvitedMember } from '../onboarding-context';
import { useOnboarding } from '../onboarding-context';

type InviteEntry = { email: string };

const LARGE_TEAM_THRESHOLD = 25;
const CONTACT_SALES_URL = 'https://cal.com/team/macro/macro-demo-call';

export function TeamStep() {
  const ctx = useOnboarding();

  const initialEntries = (): InviteEntry[] => {
    const members = ctx.invitedMembers();
    if (members.length > 0) {
      return members.map((m) => ({ email: m.email }));
    }
    return [{ email: '' }];
  };

  const [entries, setEntries] = createSignal<InviteEntry[]>(initialEntries());
  const [errors, setErrors] = createSignal<Record<number, string>>({});

  const hasValidEmail = () =>
    entries().some(
      (e) =>
        e.email.trim() !== '' && z.string().email().safeParse(e.email).success
    );

  const isLargeTeam = () => entries().length >= LARGE_TEAM_THRESHOLD;

  const emailPlaceholder = () => {
    const email = ctx.email();
    if (!email) return 'colleague@company.com';
    const domain = email.split('@')[1];
    return domain ? `colleague@${domain}` : 'colleague@company.com';
  };

  const syncMembers = (next: InviteEntry[]) => {
    const valid: InvitedMember[] = next
      .filter(
        (e) =>
          e.email.trim() !== '' && z.string().email().safeParse(e.email).success
      )
      .map((e) => ({ email: e.email, tier: 'opus' }));
    ctx.setInvitedMembers(valid);
  };

  const updateEmail = (index: number, value: string) => {
    const next = [...entries()];
    next[index] = { email: value };
    setEntries(next);
    syncMembers(next);
    if (errors()[index]) {
      setErrors((prev) => {
        const copy = { ...prev };
        delete copy[index];
        return copy;
      });
    }
  };

  const removeEntry = (index: number) => {
    const next = entries().filter((_, i) => i !== index);
    setEntries(next);
    syncMembers(next);
    setErrors((prev) => {
      const reindexed: Record<number, string> = {};
      for (const [key, value] of Object.entries(prev)) {
        const k = Number(key);
        if (k < index) reindexed[k] = value;
        else if (k > index) reindexed[k - 1] = value;
      }
      return reindexed;
    });
  };

  const validateOnBlur = (index: number, value: string) => {
    if (value.trim() === '') return;
    const result = z.string().email().safeParse(value);
    if (!result.success) {
      setErrors((prev) => ({ ...prev, [index]: 'Invalid email address' }));
    }
  };

  const addEntry = () => {
    const idx = entries().length;
    setEntries((prev) => [...prev, { email: '' }]);
    requestAnimationFrame(() => {
      document.getElementById(`onb-invite-${idx}`)?.focus();
    });
  };

  const handleContinue = () => {
    const errs: Record<number, string> = {};
    entries().forEach((e, i) => {
      if (e.email.trim() !== '') {
        const result = z.string().email().safeParse(e.email);
        if (!result.success) errs[i] = 'Invalid email address';
      }
    });
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;

    syncMembers(entries());
    ctx.next();
  };

  return (
    <div class="flex flex-col gap-8 w-full mobile:h-full">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold text-ink tracking-tight">
          Invite your team
        </h1>
        <p class="text-sm text-ink-disabled">
          Add teammates to{' '}
          <strong class="text-ink font-medium">{ctx.teamName()}</strong>. You
          can always invite more later.
        </p>
      </div>

      <div class="flex flex-col gap-2 mobile:min-h-0">
        <div class="flex flex-col gap-2 p-1 -m-1 mobile:min-h-0 mobile:overflow-y-auto mobile:scrollbar-hidden">
          <Index each={entries()}>
            {(entry, index) => (
              <div class="flex flex-col gap-1">
                <div class="relative">
                  <input
                    id={`onb-invite-${index}`}
                    type="email"
                    value={entry().email}
                    onInput={(e) => updateEmail(index, e.currentTarget.value)}
                    onBlur={(e) => validateOnBlur(index, e.currentTarget.value)}
                    placeholder={emailPlaceholder()}
                    class={cn(
                      'w-full px-2.5 h-9 pr-9 text-sm rounded-sm border bg-transparent text-ink placeholder:text-ink-placeholder transition-colors',
                      'outline-none focus:ring-2 focus:ring-accent focus:ring-offset-1 focus:ring-offset-surface',
                      errors()[index] ? 'border-failure' : 'border-edge-muted'
                    )}
                  />
                  <Show when={entry().email.trim() !== ''}>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        entries().length > 1
                          ? removeEntry(index)
                          : updateEmail(index, '')
                      }
                      class="absolute right-1.5 top-1/2 -translate-y-1/2 text-ink-disabled not-disabled:hover:text-ink-muted"
                      noTouchResize
                    >
                      <XIcon class="size-3.5" />
                    </Button>
                  </Show>
                </div>
                <Show when={errors()[index]}>
                  <p class="text-xs text-failure">{errors()[index]}</p>
                </Show>
              </div>
            )}
          </Index>
        </div>

        <Show
          when={hasValidEmail()}
          fallback={
            <div class="flex flex-col items-center gap-2 py-8 text-center">
              <div class="size-10 rounded-full bg-accent-bg flex items-center justify-center">
                <UsersIcon class="size-5 text-accent" />
              </div>
              <p class="text-sm text-ink-muted">It's quiet in here...</p>
              <p class="text-xs text-ink-disabled">
                Add your first teammate above
              </p>
            </div>
          }
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={addEntry}
            class="w-full justify-center [&_svg]:size-3"
          >
            <PlusIcon />
            Add another
          </Button>
        </Show>
      </div>

      <div class="flex flex-col gap-2 mobile:mt-auto">
        <Show
          when={isLargeTeam()}
          fallback={
            <Show
              when={hasValidEmail()}
              fallback={
                <Button
                  variant="base"
                  size="lg"
                  onClick={() => {
                    ctx.setInvitedMembers([]);
                    ctx.next();
                  }}
                  class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
                >
                  Maybe later
                  <ArrowRightIcon class="size-4" />
                </Button>
              }
            >
              <Button
                variant="base"
                size="lg"
                onClick={handleContinue}
                class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
              >
                Continue
                <ArrowRightIcon class="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  ctx.setInvitedMembers([]);
                  ctx.next();
                }}
                class="w-full"
              >
                Maybe later
              </Button>
            </Show>
          }
        >
          <Layer depth={1}>
            <div class="rounded-sm border border-edge-muted bg-surface p-3 flex flex-col gap-1">
              <p class="text-sm font-medium text-ink">
                Inviting more than {LARGE_TEAM_THRESHOLD} teammates?
              </p>
              <p class="text-xs text-ink-muted">
                Let's chat — we'll set you up with a custom plan that fits.
              </p>
            </div>
          </Layer>
          <Button
            variant="base"
            size="lg"
            onClick={() =>
              window.open(CONTACT_SALES_URL, '_blank', 'noopener,noreferrer')
            }
            class="w-full bg-accent text-surface border-accent not-disabled:hover:bg-accent/90 not-disabled:hover:text-surface focus-visible:bg-accent focus-visible:text-surface focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface"
          >
            <CalendarIcon class="size-4" />
            Book a call
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => {
              ctx.setInvitedMembers([]);
              ctx.next();
            }}
            class="w-full"
          >
            Maybe later
          </Button>
        </Show>
      </div>
    </div>
  );
}
