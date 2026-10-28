import { fireAndForget } from '@core/util/fireAndForget';
import CalendarBlank from '@icon/system/regular/calendar-blank.svg';
import CalendarCheck from '@icon/system/regular/calendar-check.svg';
import Copy from '@icon/system/regular/copy.svg';
import Power from '@icon/system/regular/power.svg';
import Question from '@icon/system/regular/question.svg';
import Warning from '@icon/system/regular/warning.svg';
import { Button } from '@ui';
import {
  type Component,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  DAY_UNITS,
  describeBookingValue,
  MINUTE_UNITS,
  NOTICE_UNITS,
} from '../core/booking-units';
import { configuredBookingQuestions } from '../core/event-editor';
import type {
  AvailabilitySchedule,
  EventType,
  SchedulingMember,
} from '../core/types';
import { meetingPlaceLabel } from '../core/types';
import { BookingFieldInfo } from './booking-field-info';
import { FieldError } from './fields';

type ReviewIcon = Component<{ class: string; 'aria-hidden'?: 'true' }>;

function ReviewSection(props: {
  label: string;
  icon: ReviewIcon;
  headingAction?: JSX.Element;
  children: JSX.Element;
}) {
  return (
    <section class="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3">
      <Dynamic
        component={props.icon}
        class="mt-0.5 size-5 shrink-0 text-ink-muted"
        aria-hidden="true"
      />
      <div class="flex min-w-0 flex-col gap-3">
        <div class="flex min-w-0 items-center gap-0.5">
          <h4 class="min-w-0 text-sm font-normal tracking-wide text-ink-muted">
            {props.label}
          </h4>
          {props.headingAction}
        </div>
        {props.children}
      </div>
    </section>
  );
}

function ReviewValue(props: { label: string; children: JSX.Element }) {
  return (
    <div class="flex min-w-0 flex-col gap-0.5">
      <dt class="text-xs font-medium leading-relaxed text-ink-muted">
        {props.label}
      </dt>
      <dd class="min-w-0 break-words text-sm [overflow-wrap:anywhere]">
        {props.children}
      </dd>
    </div>
  );
}

export function EventReview(props: {
  draft: EventType;
  link: string;
  schedule?: AvailabilitySchedule;
  members: SchedulingMember[];
  team: boolean;
  active: boolean;
  saving: boolean;
  onCopyLink?: () => Promise<void>;
  statusControl?: JSX.Element;
}) {
  const [copying, setCopying] = createSignal(false);
  const [copyError, setCopyError] = createSignal('');
  const copyErrorId = createUniqueId();
  const questions = () => configuredBookingQuestions(props.draft.questions);
  const buffers = () =>
    [
      props.draft.beforeMinutes
        ? `${describeBookingValue(props.draft.beforeMinutes, MINUTE_UNITS)} before`
        : '',
      props.draft.afterMinutes
        ? `${describeBookingValue(props.draft.afterMinutes, MINUTE_UNITS)} after`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
  const copyLink = async () => {
    if (!props.onCopyLink || copying() || props.saving) return;
    setCopyError('');
    setCopying(true);
    try {
      await props.onCopyLink();
    } catch {
      setCopyError('Could not copy booking link. Try again.');
    } finally {
      setCopying(false);
    }
  };
  return (
    <div class="flex min-w-0 flex-col gap-5 text-sm">
      <section class="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-x-3">
        <CalendarBlank
          class="mt-1 size-5 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <div class="flex min-w-0 flex-col gap-4">
          <dl class="grid gap-3">
            <ReviewValue label="Title">
              <p data-booking-review-title>{props.draft.title}</p>
            </ReviewValue>
            <ReviewValue label="Description">
              <Show
                when={props.draft.description}
                fallback={<p class="text-ink-muted">No description</p>}
              >
                <p class="whitespace-pre-wrap">{props.draft.description}</p>
              </Show>
            </ReviewValue>
            <ReviewValue label="Link">
              <div class="flex min-w-0 items-start gap-2">
                <span class="min-w-0 break-words [overflow-wrap:anywhere]">
                  {props.link}
                </span>
                <Show when={props.onCopyLink}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    label="Copy booking link"
                    disabled={props.saving || copying() || !props.onCopyLink}
                    aria-invalid={copyError() ? true : undefined}
                    aria-describedby={copyError() ? copyErrorId : undefined}
                    class="shrink-0 aria-invalid:ring-2 aria-invalid:ring-failure/40"
                    onClick={() => fireAndForget(copyLink(), 'scheduling')}
                  >
                    <Copy class="size-4" aria-hidden="true" />
                  </Button>
                </Show>
              </div>
              <FieldError id={copyErrorId} message={copyError()} />
            </ReviewValue>
          </dl>
          <dl class="mt-1 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <ReviewValue label="Duration">
              {describeBookingValue(props.draft.durationMinutes, MINUTE_UNITS)}
            </ReviewValue>
            <ReviewValue label="Status">
              {props.active && !props.draft.requiresConfirmation
                ? 'Active'
                : 'Paused'}
            </ReviewValue>
            <ReviewValue label="Meeting location">
              {props.draft.macroCall ||
              props.draft.googleMeet ||
              props.draft.location
                ? meetingPlaceLabel(props.draft)
                : 'No location set'}
            </ReviewValue>
            <ReviewValue label="Availability">
              {props.schedule?.name ?? 'No availability schedule'}
            </ReviewValue>
            <Show when={props.schedule}>
              <ReviewValue label="Time zone">
                {props.schedule?.timeZone.replaceAll('_', ' ')}
              </ReviewValue>
            </Show>
            <Show
              when={
                (props.draft.macroCall || props.draft.googleMeet) &&
                props.draft.location
              }
            >
              <ReviewValue label="Joining instructions">
                {props.draft.location}
              </ReviewValue>
            </Show>
            <Show when={props.team}>
              <ReviewValue label="Scheduling type">
                {props.draft.mode === 'roundRobin'
                  ? 'Round robin'
                  : 'Collective'}
              </ReviewValue>
              <ReviewValue label="Team hosts">
                {props.draft.hosts
                  .map((id) => {
                    const member = props.members.find((item) => item.id === id);
                    return (
                      member?.name || member?.email || 'Former team member'
                    );
                  })
                  .join(', ')}
              </ReviewValue>
            </Show>
          </dl>
        </div>
      </section>
      <ReviewSection
        label="Questions"
        icon={Question}
        headingAction={
          <BookingFieldInfo
            label="Attendee details"
            description="Name and email are always collected."
          >
            <Warning class="size-3.5" aria-hidden="true" />
          </BookingFieldInfo>
        }
      >
        <Show
          when={questions().length}
          fallback={<p class="text-ink-muted">No custom questions</p>}
        >
          <dl class="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            <For each={questions()}>
              {(question) => (
                <ReviewValue label={question.label}>
                  {question.required ? 'Required' : 'Optional'}
                </ReviewValue>
              )}
            </For>
          </dl>
        </Show>
      </ReviewSection>
      <ReviewSection label="Booking rules" icon={CalendarCheck}>
        <dl class="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          <ReviewValue label="Time between meetings">
            {buffers() || 'No buffers'}
          </ReviewValue>
          <ReviewValue label="Minimum notice">
            {props.draft.noticeMinutes
              ? describeBookingValue(props.draft.noticeMinutes, NOTICE_UNITS)
              : 'No minimum notice'}
          </ReviewValue>
          <ReviewValue label="Booking window">
            {describeBookingValue(props.draft.horizonDays, DAY_UNITS)}
          </ReviewValue>
          <ReviewValue label="Time-slot interval">
            {describeBookingValue(props.draft.intervalMinutes, MINUTE_UNITS)}
          </ReviewValue>
          <ReviewValue label="Daily booking limit">
            {props.draft.dailyLimit === null
              ? 'No daily limit'
              : `${props.draft.dailyLimit} booking${props.draft.dailyLimit === 1 ? '' : 's'} per day`}
          </ReviewValue>
        </dl>
      </ReviewSection>
      <Show when={props.statusControl}>
        {(control) => (
          <ReviewSection label="Enabled" icon={Power}>
            {control()}
          </ReviewSection>
        )}
      </Show>
    </div>
  );
}
