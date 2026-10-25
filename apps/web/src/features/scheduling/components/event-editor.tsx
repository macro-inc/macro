import { fireAndForget } from '@core/util/fireAndForget';
import { Popover } from '@kobalte/core/popover';
import ArrowCounterClockwise from '@phosphor/arrow-counter-clockwise.svg';
import PencilSimple from '@phosphor/pencil-simple.svg';
import Plus from '@phosphor/plus.svg';
import Trash from '@phosphor/trash.svg';
import VideoCamera from '@phosphor/video-camera.svg';
import Warning from '@phosphor/warning.svg';
import { Button, Tabs, ToggleSwitch } from '@ui';
import { Stepper } from '@ui/components/Stepper';
import {
  batch,
  createEffect,
  createSignal,
  createUniqueId,
  For,
  Index,
  type JSX,
  on,
  Show,
} from 'solid-js';
import { MINUTE_UNITS } from '../core/booking-units';
import {
  EVENT_EDITOR_STEPS,
  type EventDetail,
  type EventEditorStep,
} from '../core/event-editor';
import type {
  AvailabilitySchedule,
  BookingQuestion,
  EventType,
  EventValidationIssue,
  SchedulingMember,
} from '../core/types';
import { BookingDurationInput } from './booking-duration-input';
import { BookingFieldInfo } from './booking-field-info';
import { BookingHostSelector } from './booking-host-selector';
import { BookingRules as BookingRuleSliders } from './booking-rules';
import { BookingValueSlider } from './booking-value-slider';
import {
  EventEditorProgress,
  EventEditorStepMenu,
} from './event-editor-progress';
import { EventReview } from './event-review';
import {
  CheckField,
  Field,
  FieldError,
  SelectInput,
  TextArea,
  TextInput,
} from './fields';
import { WeeklyHoursSummary } from './weekly-hours-summary';

export type EventEditorProps = {
  draft: EventType;
  schedules: AvailabilitySchedule[];
  members: SchedulingMember[];
  team: boolean;
  saving: boolean;
  isNew: boolean;
  createActive: boolean;
  details: EventDetail[];
  canResetTeamSettings: boolean;
  step: EventEditorStep;
  stepMenuOpen: boolean;
  onStepMenuOpenChange: (open: boolean) => void;
  issues: EventValidationIssue[];
  validationAttempt: number;
  submitError: string;
  availability?: JSX.Element;
  submitLabel?: string;
  link?: string;
  savedLink?: string;
  onTitle: (title: string) => void;
  onUpdate: <K extends keyof EventType>(key: K, value: EventType[K]) => void;
  onAddDetail: (detail: EventDetail) => void;
  onRemoveDetail: (detail: EventDetail) => void;
  onBuffers: (before: number, after: number) => void;
  onDailyLimitEnabled: (enabled: boolean) => void;
  onStep: (step: EventEditorStep) => void;
  onNext: () => void;
  onBack: () => void;
  onSave: () => Promise<void>;
  onCopyLink?: () => Promise<void>;
  onCancel: () => void;
};

function QuestionField(props: {
  question: BookingQuestion;
  index: number;
  disabled: boolean;
  error?: string;
  onUpdate: (
    changes: Partial<Pick<BookingQuestion, 'label' | 'required'>>
  ) => void;
  onRemove: () => void;
}) {
  const inputId = createUniqueId();
  const errorId = createUniqueId();
  return (
    <div data-booking-question-row class="flex flex-col gap-2">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <label for={inputId} class="text-sm font-normal text-ink-muted">
          Question {props.index + 1}
        </label>
        <div class="flex items-center gap-3">
          <CheckField
            label="Required"
            class="gap-2"
            controlClass="bg-transparent"
            checked={props.question.required}
            disabled={props.disabled}
            onChange={(required) => props.onUpdate({ required })}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            label={`Remove question ${props.index + 1}`}
            disabled={props.disabled}
            onClick={props.onRemove}
          >
            <Trash class="size-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>
      <TextInput
        size="lg"
        class="text-base sm:text-sm"
        id={inputId}
        data-booking-question-input
        value={props.question.label}
        placeholder="What would you like to discuss?"
        disabled={props.disabled}
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        onInput={(event) =>
          props.onUpdate({ label: event.currentTarget.value })
        }
      />
      <FieldError id={errorId} message={props.error} />
    </div>
  );
}

export function EventEditor(props: EventEditorProps) {
  const descriptionId = createUniqueId();
  const [linkTrigger, setLinkTrigger] = createSignal<HTMLButtonElement>();
  const [linkOpen, setLinkOpen] = createSignal(false);
  const slugErrorId = createUniqueId();
  const hostsErrorId = createUniqueId();
  const submitErrorId = createUniqueId();
  const availabilityErrorId = createUniqueId();
  const progressId = createUniqueId();
  const error = (field: EventValidationIssue['field']) =>
    props.issues.find((issue) => issue.field === field)?.message;
  const primaryError = () =>
    props.submitError || (!props.team ? error('hosts') : undefined);
  let addQuestionTrigger: HTMLButtonElement | undefined;
  let questionsContent: HTMLDivElement | undefined;
  const restoreQuestionFocus = (index?: number) => {
    queueMicrotask(() => {
      const inputs = questionsContent?.querySelectorAll<HTMLInputElement>(
        '[data-booking-question-input]'
      );
      const target =
        index !== undefined && inputs?.length
          ? inputs[Math.min(index, inputs.length - 1)]
          : addQuestionTrigger;
      if (
        props.saving ||
        !target?.isConnected ||
        target.closest('[hidden], [inert]')
      )
        return;
      target.focus();
    });
  };
  const removeQuestion = (id: string) => {
    if (props.saving) return;
    const questions = props.draft.questions;
    const index = questions.findIndex((question) => question.id === id);
    if (index === -1) return;
    props.onUpdate(
      'questions',
      questions.filter((question) => question.id !== id)
    );
    restoreQuestionFocus(index);
  };
  let formElement: HTMLFormElement | undefined;
  let scrollArea: HTMLDivElement | undefined;
  const stepIndex = () =>
    EVENT_EDITOR_STEPS.findIndex((entry) => entry.id === props.step);
  const schedule = () =>
    props.schedules.find((item) => item.id === props.draft.scheduleId);
  const missingHosts = () =>
    props.draft.hosts.filter(
      (id) => !props.members.some((member) => member.id === id)
    );
  const primaryLabel = () =>
    props.submitLabel ?? (props.isNew ? 'Create link' : 'Save changes');
  createEffect(
    on(
      () => [props.step, props.validationAttempt] as const,
      ([nextStep, attempt], previous) => {
        if (!previous) return;
        const changedStep = nextStep !== previous[0];
        queueMicrotask(() => {
          if (props.step !== nextStep || props.validationAttempt !== attempt)
            return;
          const panel = formElement?.querySelector<HTMLElement>(
            `[data-booking-step="${nextStep}"]`
          );
          if (!panel) return;
          if (changedStep) {
            if (scrollArea) scrollArea.scrollTop = 0;
          }
          const invalid =
            [
              ...panel.querySelectorAll<HTMLElement>(
                'input[aria-invalid="true"], button[aria-invalid="true"], [tabindex][aria-invalid="true"]'
              ),
            ].find(
              (element) =>
                !(
                  nextStep === 'rules' &&
                  element.getAttribute('role') === 'slider'
                ) &&
                !element.closest('[hidden], [inert], [aria-hidden="true"]') &&
                !element.matches(
                  ':disabled, input[type="hidden"], input[type="range"][tabindex="-1"]'
                )
            ) ??
            formElement?.querySelector<HTMLButtonElement>(
              'button[type="submit"][aria-invalid="true"]'
            );
          if (invalid) {
            invalid.focus({ preventScroll: false });
            const message = (invalid.getAttribute('aria-describedby') ?? '')
              .split(' ')
              .map((id) => document.getElementById(id))
              .find((element) => element?.getAttribute('role') === 'alert');
            message?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          } else if (changedStep) panel.focus({ preventScroll: true });
        });
      }
    )
  );
  return (
    <form
      ref={formElement}
      class={`flex flex-col ${
        props.step === 'review'
          ? 'h-auto min-h-[min(36rem,calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-var(--safe-bottom,0px)-4rem))] max-h-[calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-var(--safe-bottom,0px)-4rem)]'
          : 'h-[min(36rem,calc(100dvh-var(--virtual-keyboard-height,0px)-var(--safe-top,0px)-var(--safe-bottom,0px)-4rem))] min-h-0'
      }`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (props.saving) return;
        if (props.step === 'review')
          fireAndForget(props.onSave(), 'scheduling');
        else props.onNext();
      }}
    >
      <div
        ref={scrollArea}
        data-booking-scroll-area
        class={`min-h-0 overflow-y-auto overscroll-contain px-5 pt-4 pb-7 sm:px-6 ${props.step === 'review' ? 'flex-auto' : 'flex-1'}`}
      >
        <Stepper
          step={stepIndex()}
          keepMounted
          transition={Stepper.transitions.slide}
        >
          <Stepper.Step>
            <fieldset
              data-booking-step="details"
              tabindex="-1"
              disabled={props.saving || props.step !== 'details'}
              aria-labelledby={progressId}
              class="flex min-w-0 flex-col gap-6 outline-none"
            >
              <div class="flex min-w-0 flex-col gap-2">
                <Field
                  label="Title"
                  error={error('title')}
                  class="text-base"
                  labelClass="text-sm font-normal text-ink-muted"
                >
                  <TextInput
                    required
                    size="lg"
                    class="text-base sm:text-sm"
                    placeholder="30 minute meeting"
                    value={props.draft.title}
                    onInput={(event) =>
                      props.onTitle(event.currentTarget.value)
                    }
                  />
                </Field>
                <div class="flex min-w-0 flex-col gap-1.5">
                  <div class="flex min-w-0 items-start gap-2">
                    <p class="min-w-0 flex-1 break-all text-xs leading-relaxed text-ink-muted">
                      {props.link ?? `/${props.draft.slug || 'your-link'}`}
                    </p>
                    <Popover
                      placement="bottom-end"
                      gutter={8}
                      modal={false}
                      open={linkOpen()}
                      onOpenChange={setLinkOpen}
                    >
                      <Popover.Trigger
                        as={Button}
                        ref={setLinkTrigger}
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        label="Edit link"
                        class="shrink-0 -mt-0.5 text-ink-muted aria-invalid:ring-2 aria-invalid:ring-failure/40"
                        aria-invalid={error('slug') ? true : undefined}
                        aria-describedby={
                          error('slug') && !linkOpen() ? slugErrorId : undefined
                        }
                      >
                        <PencilSimple class="size-3.5" />
                      </Popover.Trigger>
                      <Popover.Portal
                        mount={
                          linkTrigger()?.closest<HTMLElement>(
                            '.portal-scope'
                          ) ?? undefined
                        }
                      >
                        <Popover.Content class="menu-surface z-action-menu w-80 max-w-[min(20rem,var(--kb-popper-content-available-width),calc(100vw-2rem))] p-4 outline-none">
                          <Popover.Title class="sr-only">
                            Edit booking link
                          </Popover.Title>
                          <Field
                            label="Custom link"
                            class="text-base"
                            labelClass="text-sm font-normal text-ink-muted"
                            hint="Optional. Leave blank to use the meeting title."
                            error={error('slug')}
                          >
                            <TextInput
                              size="lg"
                              class="text-base sm:text-sm"
                              aria-label="Custom link"
                              value={props.draft.slug}
                              disabled={props.saving}
                              onInput={(event) =>
                                props.onUpdate(
                                  'slug',
                                  event.currentTarget.value
                                )
                              }
                            />
                          </Field>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            class="mt-2 -ml-2"
                            disabled={props.saving}
                            onClick={() => props.onRemoveDetail('link')}
                          >
                            Reset to title
                          </Button>
                        </Popover.Content>
                      </Popover.Portal>
                    </Popover>
                  </div>
                  <FieldError
                    id={slugErrorId}
                    message={linkOpen() ? undefined : error('slug')}
                  />
                </div>
              </div>
              <div class="flex flex-col gap-2">
                <label
                  for={descriptionId}
                  class="text-sm font-normal text-ink-muted"
                >
                  Description
                </label>
                <TextArea
                  id={descriptionId}
                  rows={3}
                  class="min-h-20 text-base sm:text-sm"
                  value={props.draft.description}
                  placeholder="What should guests know before booking?"
                  onInput={(event) =>
                    props.onUpdate('description', event.currentTarget.value)
                  }
                />
              </div>
              <BookingValueSlider
                label="Duration"
                value={props.draft.durationMinutes}
                min={5}
                max={480}
                unit="min"
                units={MINUTE_UNITS}
                sliderStep={15}
                disabled={props.saving}
                error={error('durationMinutes')}
                onChange={(value) => props.onUpdate('durationMinutes', value)}
              >
                {(errorId) => (
                  <BookingDurationInput
                    value={props.draft.durationMinutes}
                    disabled={props.saving}
                    error={error('durationMinutes')}
                    errorId={errorId}
                    onChange={(value) =>
                      props.onUpdate('durationMinutes', value)
                    }
                  />
                )}
              </BookingValueSlider>
            </fieldset>
          </Stepper.Step>
          <Stepper.Step>
            <fieldset
              data-booking-step="location"
              tabindex="-1"
              disabled={props.saving || props.step !== 'location'}
              aria-labelledby={progressId}
              class="flex min-w-0 flex-col gap-6 outline-none"
            >
              <section class="flex flex-col gap-2">
                <h4 class="text-sm font-normal tracking-wide text-ink-muted">
                  Meeting location
                </h4>
                <div class="flex flex-col gap-3">
                  <div
                    role="group"
                    aria-label="Meeting location presets"
                    class="flex flex-wrap gap-2"
                  >
                    <For
                      each={[
                        { kind: 'macro', label: 'Macro call' },
                        { kind: 'google', label: 'Video meeting' },
                        { kind: 'custom', label: 'Custom' },
                      ]}
                    >
                      {(option) => {
                        const selected = () =>
                          option.kind === 'macro'
                            ? props.draft.macroCall
                            : option.kind === 'google'
                              ? props.draft.googleMeet
                              : !props.draft.macroCall &&
                                !props.draft.googleMeet;
                        return (
                          <Button
                            type="button"
                            size="md"
                            variant="ghost"
                            aria-pressed={selected()}
                            class={`rounded-full border px-4 ${
                              selected()
                                ? 'border-accent/30 bg-accent/10 text-accent not-touch:not-disabled:hover:bg-accent/15 not-touch:not-disabled:hover:text-accent'
                                : 'border-edge-frame text-ink-muted not-touch:not-disabled:hover:text-ink-muted'
                            }`}
                            onClick={() =>
                              batch(() => {
                                props.onUpdate(
                                  'macroCall',
                                  option.kind === 'macro'
                                );
                                props.onUpdate(
                                  'googleMeet',
                                  option.kind === 'google'
                                );
                              })
                            }
                          >
                            <Show when={option.kind !== 'custom'}>
                              <VideoCamera class="size-4" aria-hidden="true" />
                            </Show>
                            {option.label}
                          </Button>
                        );
                      }}
                    </For>
                  </div>
                  <Show
                    when={!props.draft.macroCall && !props.draft.googleMeet}
                  >
                    <TextInput
                      size="lg"
                      class="w-full text-base sm:text-sm"
                      aria-label="Location or meeting URL"
                      value={props.draft.location}
                      placeholder="Address, phone number, or meeting URL"
                      onInput={(event) =>
                        props.onUpdate('location', event.currentTarget.value)
                      }
                    />
                  </Show>
                  <Show when={props.draft.macroCall || props.draft.googleMeet}>
                    <TextInput
                      size="lg"
                      class="w-full text-base sm:text-sm"
                      aria-label="Joining instructions"
                      value={props.draft.location}
                      disabled={props.saving}
                      placeholder="Extra directions or a backup meeting link"
                      onInput={(event) =>
                        props.onUpdate('location', event.currentTarget.value)
                      }
                    />
                  </Show>
                </div>
              </section>
              <section>
                <div class="mb-2 flex items-center gap-1">
                  <h4 class="text-sm font-normal tracking-wide text-ink-muted">
                    Availability
                  </h4>
                  <BookingFieldInfo
                    label="Availability"
                    description="Busy times on connected calendars are excluded automatically."
                  />
                </div>
                <Show
                  when={props.availability}
                  fallback={
                    <SelectInput
                      label="Availability schedule"
                      value={props.draft.scheduleId}
                      class="h-9 rounded-lg px-3 text-sm"
                      disabled={props.saving || props.step !== 'location'}
                      error={error('scheduleId')}
                      options={props.schedules.map((item) => ({
                        value: item.id,
                        label: item.name,
                      }))}
                      onChange={(value) => props.onUpdate('scheduleId', value)}
                    />
                  }
                >
                  <div
                    role="group"
                    aria-label="Availability schedule"
                    tabindex="-1"
                    aria-invalid={error('scheduleId') ? true : undefined}
                    aria-describedby={
                      error('scheduleId') ? availabilityErrorId : undefined
                    }
                    class="flex flex-col gap-2 rounded-lg outline-none aria-invalid:ring-2 aria-invalid:ring-failure/30"
                  >
                    {props.availability}
                    <FieldError
                      id={availabilityErrorId}
                      message={error('scheduleId')}
                    />
                  </div>
                </Show>
                <Show when={schedule()}>
                  {(hours) => <WeeklyHoursSummary schedule={hours()} />}
                </Show>
              </section>
              <Show when={props.team}>
                <section class="flex min-w-0 flex-col gap-2">
                  <div class="flex items-center justify-between gap-2">
                    <h4 class="text-sm font-normal tracking-wide text-ink-muted">
                      Team scheduling
                    </h4>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      label="Reset team settings"
                      disabled={
                        props.saving ||
                        props.step !== 'location' ||
                        !props.canResetTeamSettings
                      }
                      onClick={() => props.onRemoveDetail('hosts')}
                    >
                      <ArrowCounterClockwise
                        class="size-3.5"
                        aria-hidden="true"
                      />
                    </Button>
                  </div>
                  <div class="flex min-w-0 flex-col gap-3">
                    <Tabs
                      touch="pills"
                      aria-label="Scheduling type"
                      disabled={props.saving || props.step !== 'location'}
                      options={[
                        { value: 'collective', label: 'Collective' },
                        { value: 'roundRobin', label: 'Round robin' },
                      ]}
                      value={props.draft.mode}
                      onChange={(mode) => props.onUpdate('mode', mode)}
                    />
                    <div class="flex w-72 max-w-full min-w-0 flex-col gap-2">
                      <div class="flex min-w-0 items-center gap-2">
                        <div class="min-w-0 flex-1">
                          <BookingHostSelector
                            members={props.members}
                            value={props.draft.hosts}
                            disabled={props.saving || props.step !== 'location'}
                            invalid={!!error('hosts')}
                            descriptionId={
                              error('hosts') ? hostsErrorId : undefined
                            }
                            onChange={(hosts) => props.onUpdate('hosts', hosts)}
                          />
                        </div>
                        <BookingFieldInfo
                          label="Team hosts"
                          description="Hosts need a connected calendar."
                        >
                          <Warning
                            class="size-3.5 text-warning"
                            aria-hidden="true"
                          />
                        </BookingFieldInfo>
                      </div>
                      <FieldError id={hostsErrorId} message={error('hosts')} />
                      <Show when={missingHosts().length && !error('hosts')}>
                        <p class="text-xs text-warning">
                          Remove former team members from the selected hosts
                          before saving.
                        </p>
                      </Show>
                    </div>
                  </div>
                </section>
              </Show>
            </fieldset>
          </Stepper.Step>
          <Stepper.Step>
            <fieldset
              data-booking-step="questions"
              tabindex="-1"
              disabled={props.saving || props.step !== 'questions'}
              aria-labelledby={progressId}
              class="flex min-w-0 flex-col gap-6 outline-none"
            >
              <div ref={questionsContent} class="flex flex-col gap-6">
                <Index each={props.draft.questions}>
                  {(question, index) => (
                    <QuestionField
                      question={question()}
                      index={index}
                      disabled={props.saving}
                      error={
                        props.issues.find(
                          (issue) =>
                            issue.field === 'questions' &&
                            issue.questionId === question().id
                        )?.message
                      }
                      onUpdate={(changes) =>
                        props.onUpdate(
                          'questions',
                          props.draft.questions.map((item) =>
                            item.id === question().id
                              ? { ...item, ...changes }
                              : item
                          )
                        )
                      }
                      onRemove={() => removeQuestion(question().id)}
                    />
                  )}
                </Index>
                <div class="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    ref={addQuestionTrigger}
                    variant="ghost"
                    class="-ml-2 self-start"
                    onClick={() =>
                      props.onUpdate('questions', [
                        ...props.draft.questions,
                        { id: crypto.randomUUID(), label: '', required: false },
                      ])
                    }
                  >
                    <Plus class="size-4" />
                    Add a question
                  </Button>
                </div>
              </div>
            </fieldset>
          </Stepper.Step>
          <Stepper.Step>
            <fieldset
              data-booking-step="rules"
              tabindex="-1"
              disabled={props.saving || props.step !== 'rules'}
              aria-labelledby={progressId}
              class="flex min-w-0 flex-col gap-6 outline-none"
            >
              <BookingRuleSliders
                draft={props.draft}
                disabled={props.saving || props.step !== 'rules'}
                issues={props.issues}
                onUpdate={props.onUpdate}
                onBuffers={props.onBuffers}
                onDailyLimitEnabled={props.onDailyLimitEnabled}
              />
            </fieldset>
          </Stepper.Step>
          <Stepper.Step>
            <div
              data-booking-step="review"
              tabindex="-1"
              aria-labelledby={progressId}
              class="flex flex-col gap-4 outline-none"
            >
              <Show when={props.step === 'review'}>
                <EventReview
                  draft={props.draft}
                  link={props.savedLink ?? props.link ?? `/${props.draft.slug}`}
                  schedule={schedule()}
                  members={props.members}
                  team={props.team}
                  active={
                    ((props.isNew && props.createActive) ||
                      props.draft.enabled) &&
                    !props.draft.requiresConfirmation
                  }
                  saving={props.saving}
                  onCopyLink={props.onCopyLink}
                  statusControl={
                    !props.isNew ? (
                      <ToggleSwitch
                        size="md"
                        label="Enabled"
                        class="self-start"
                        labelClass="sr-only"
                        checked={props.draft.enabled}
                        disabled={props.saving}
                        onChange={(enabled) =>
                          props.onUpdate('enabled', enabled)
                        }
                      />
                    ) : undefined
                  }
                />
                <Show when={props.draft.requiresConfirmation}>
                  <div class="rounded-lg bg-warning-bg p-3 text-sm">
                    <p>
                      This legacy link is paused until automatic confirmation is
                      enabled.
                    </p>
                    <Button
                      type="button"
                      disabled={props.saving}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        props.onUpdate('requiresConfirmation', false)
                      }
                    >
                      Use automatic confirmation
                    </Button>
                  </div>
                </Show>
              </Show>
            </div>
          </Stepper.Step>
        </Stepper>
      </div>
      <header class="order-first flex shrink-0 items-center justify-between gap-4 px-5 pt-6 pb-4 sm:px-6">
        <div class="flex min-w-0 items-center gap-2">
          <EventEditorStepMenu
            step={stepIndex()}
            open={props.stepMenuOpen}
            onOpenChange={props.onStepMenuOpenChange}
            disabled={props.saving}
            onStep={props.onStep}
          />
          <h3
            id={progressId}
            class="min-w-0 text-xl font-medium leading-snug tracking-wide"
          >
            {EVENT_EDITOR_STEPS[stepIndex()].heading}
          </h3>
        </div>
        <EventEditorProgress step={stepIndex()} />
      </header>
      <Show when={props.step === 'questions'}>
        <p
          data-booking-attendee-note
          class="flex shrink-0 items-center gap-1.5 px-5 pb-4 text-xs text-ink-muted sm:px-6"
        >
          <Warning class="size-3.5 shrink-0" aria-hidden="true" />
          Name and email are always collected.
        </p>
      </Show>
      <footer class="flex shrink-0 flex-wrap items-start justify-between gap-3 border-t border-edge-frame px-5 py-4 sm:px-6">
        <Button
          type="button"
          variant="ghost"
          size="lg"
          data-booking-cancel
          disabled={props.saving}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
        <div
          data-booking-primary-actions
          class="ml-auto flex min-w-0 max-w-full items-start gap-2"
        >
          <Show when={props.step !== 'details'}>
            <Button
              type="button"
              variant="ghost"
              size="lg"
              disabled={props.saving}
              onClick={props.onBack}
            >
              Back
            </Button>
          </Show>
          <div class="flex min-w-0 max-w-full flex-col items-end gap-2">
            <Button
              type="submit"
              variant="cta"
              size="lg"
              disabled={props.saving}
              aria-invalid={primaryError() ? true : undefined}
              aria-describedby={primaryError() ? submitErrorId : undefined}
              class="aria-invalid:ring-2 aria-invalid:ring-failure/40"
            >
              <Show
                when={!props.saving && props.step === 'review' && props.isNew}
              >
                <Plus class="size-4" aria-hidden="true" />
              </Show>
              {props.saving
                ? 'Saving…'
                : props.step === 'review'
                  ? primaryLabel()
                  : 'Next'}
            </Button>
            <FieldError id={submitErrorId} message={primaryError()} />
          </div>
        </div>
      </footer>
    </form>
  );
}
