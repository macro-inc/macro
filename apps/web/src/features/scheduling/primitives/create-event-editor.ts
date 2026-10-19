import deepEqual from 'fast-deep-equal';
import { type Accessor, batch, createSignal } from 'solid-js';
import { unwrap } from 'solid-js/store';
import {
  bookingLinkSlug,
  configuredBookingQuestions,
  EVENT_EDITOR_STEPS,
  type EventDetail,
  type EventEditorStep,
  eventEditorStepIssues,
  hasCustomBookingRules,
  resetEventDetail,
} from '../core/event-editor';
import {
  type EventType,
  type EventValidationIssue,
  slugify,
} from '../core/types';

/** Owns the draft and steps; only final submission writes. */
export function createEventEditor(options: {
  event: EventType;
  events: Accessor<EventType[]>;
  missingHosts: (event: EventType) => string[];
  hasSchedule: (id: string) => boolean;
  createActive: Accessor<boolean>;
  defaultHosts?: Accessor<string[]>;
  defaultMode?: Accessor<'individual' | 'collective'>;
  onChange?: (event: EventType) => void;
  onSave: (event: EventType) => Promise<void>;
}) {
  const initial = structuredClone(unwrap(options.event));
  const [draft, setDraftValue] = createSignal<EventType>({
    ...initial,
    questions: [
      ...initial.questions,
      ...Array.from(
        { length: Math.max(0, 2 - initial.questions.length) },
        () => ({ id: crypto.randomUUID(), label: '', required: false })
      ),
    ],
  });
  let previousDailyLimit = initial.dailyLimit ?? 5;
  const defaultHosts = () =>
    options.defaultHosts?.() ?? initial.hosts.slice(0, 1);
  const defaultMode = () =>
    options.defaultMode?.() ??
    (initial.mode === 'individual' ? 'individual' : 'collective');
  const canResetTeamSettings = () => {
    const current = draft();
    const hosts = defaultHosts();
    return (
      current.mode !== defaultMode() ||
      current.hosts.length !== hosts.length ||
      current.hosts.some((host) => !hosts.includes(host))
    );
  };
  const [customSlug, setCustomSlug] = createSignal(
    !!initial.slug.trim() && initial.slug !== slugify(initial.title)
  );
  const initialCustomSlug = customSlug();
  const [issues, setIssues] = createSignal<EventValidationIssue[]>([]);
  const [submitError, setSubmitError] = createSignal('');
  const [step, setStep] = createSignal<EventEditorStep>('details');
  const [validatedStep, setValidatedStep] = createSignal<EventEditorStep>();
  const [validationAttempt, setValidationAttempt] = createSignal(0);
  const configured: EventDetail[] = [];
  if (initial.slug && initial.slug !== slugify(initial.title))
    configured.push('link');
  if (hasCustomBookingRules(initial)) configured.push('rules');
  if (initial.questions.length) configured.push('questions');
  if (initial.mode === 'roundRobin' || initial.hosts.length > 1)
    configured.push('hosts');
  const [details, setDetails] = createSignal<EventDetail[]>(configured);
  const isNew = () =>
    !options.events().some((event) => event.id === draft().id);
  const hasSavedUrl = (event: EventType) =>
    options.events().some((saved) => saved.id === event.id);
  const automaticSlug = (event: EventType) =>
    bookingLinkSlug({ ...event, slug: '' }, options.events());
  const resolveSlug = (event: EventType) =>
    customSlug() || hasSavedUrl(event)
      ? bookingLinkSlug(event, options.events())
      : automaticSlug(event);
  const stepIssues = (current: EventEditorStep, event: EventType) => [
    ...eventEditorStepIssues(
      { ...event, slug: resolveSlug(event) },
      options.events(),
      current
    ),
    ...(current === 'location' &&
    event.scheduleId &&
    !options.hasSchedule(event.scheduleId)
      ? [
          {
            field: 'scheduleId' as const,
            message: 'Choose an availability schedule.',
          },
        ]
      : []),
    ...(current === 'location' && options.missingHosts(event).length
      ? [
          {
            field: 'hosts' as const,
            message:
              'Remove former team members from the selected hosts before saving.',
          },
        ]
      : []),
  ];
  const setDraft = (update: (current: EventType) => EventType) => {
    const next = setDraftValue(update);
    setSubmitError('');
    if (validatedStep() === step()) setIssues(stepIssues(step(), next));
    options.onChange?.(next);
    return next;
  };
  const update = <K extends keyof EventType>(key: K, value: EventType[K]) => {
    if (key === 'slug')
      setCustomSlug(typeof value === 'string' && !!value.trim());
    return setDraft((current) => ({ ...current, [key]: value }));
  };
  const setDailyLimitEnabled = (enabled: boolean) => {
    if (enabled)
      return update('dailyLimit', draft().dailyLimit ?? previousDailyLimit);
    previousDailyLimit = draft().dailyLimit ?? previousDailyLimit;
    return update('dailyLimit', null);
  };
  const updateBuffers = (beforeMinutes: number, afterMinutes: number) =>
    setDraft((current) => ({ ...current, beforeMinutes, afterMinutes }));
  const setTitle = (title: string) =>
    setDraft((current) => {
      const next = { ...current, title };
      return customSlug() || hasSavedUrl(current)
        ? next
        : { ...next, slug: automaticSlug(next) };
    });
  const addDetail = (detail: EventDetail) => {
    setSubmitError('');
    if (detail === 'link') setCustomSlug(true);
    setDetails((current) =>
      current.includes(detail) ? current : [...current, detail]
    );
  };
  const removeDetail = (detail: EventDetail) => {
    setDraft((current) => {
      const next = resetEventDetail(
        current,
        detail,
        defaultHosts(),
        defaultMode()
      );
      return detail === 'link' ? { ...next, slug: automaticSlug(next) } : next;
    });
    setDetails((current) => current.filter((value) => value !== detail));
    if (detail === 'link') setCustomSlug(false);
  };
  const slug = () => resolveSlug(draft());
  const hasChanges = () =>
    !deepEqual(
      {
        ...initial,
        slug:
          initialCustomSlug || hasSavedUrl(initial)
            ? bookingLinkSlug(initial, options.events())
            : automaticSlug(initial),
        questions: configuredBookingQuestions(initial.questions),
      },
      {
        ...draft(),
        slug: slug(),
        questions: configuredBookingQuestions(draft().questions),
      }
    );
  const canGoToStep = (target: EventEditorStep) => {
    if (target === step()) return true;
    const index = EVENT_EDITOR_STEPS.findIndex((entry) => entry.id === target);
    const current = EVENT_EDITOR_STEPS.findIndex(
      (entry) => entry.id === step()
    );
    return (
      index >= 0 &&
      (index <= current ||
        EVENT_EDITOR_STEPS.slice(0, index).every(
          (entry) => stepIssues(entry.id, draft()).length === 0
        ))
    );
  };
  const selectStep = (next: EventEditorStep) => {
    batch(() => {
      setSubmitError('');
      setIssues([]);
      setValidatedStep(undefined);
      setStep(next);
    });
  };
  const goToStep = (target: EventEditorStep) => {
    if (target === step()) return;
    const index = EVENT_EDITOR_STEPS.findIndex((entry) => entry.id === target);
    if (index < 0) return;
    const current = EVENT_EDITOR_STEPS.findIndex(
      (entry) => entry.id === step()
    );
    if (index > current) {
      for (const entry of EVENT_EDITOR_STEPS.slice(0, index)) {
        const found = stepIssues(entry.id, draft());
        if (!found.length) continue;
        batch(() => {
          setStep(entry.id);
          setValidatedStep(entry.id);
          setIssues(found);
          setSubmitError('');
          setValidationAttempt((attempt) => attempt + 1);
        });
        return;
      }
    }
    selectStep(target);
  };
  const next = () => {
    const index = EVENT_EDITOR_STEPS.findIndex((entry) => entry.id === step());
    const target = EVENT_EDITOR_STEPS[index + 1];
    if (target) goToStep(target.id);
  };
  const back = () => {
    const index = EVENT_EDITOR_STEPS.findIndex((entry) => entry.id === step());
    const target = EVENT_EDITOR_STEPS[index - 1];
    if (target) selectStep(target.id);
  };
  const save = async () => {
    const next = {
      ...draft(),
      slug: slug(),
      questions: configuredBookingQuestions(draft().questions),
      enabled: isNew() && options.createActive() ? true : draft().enabled,
    };
    setSubmitError('');
    for (const entry of EVENT_EDITOR_STEPS) {
      if (entry.id === 'review') break;
      const found = stepIssues(entry.id, next);
      if (found.length) {
        batch(() => {
          setStep(entry.id);
          setValidatedStep(entry.id);
          setIssues(found);
          setValidationAttempt((attempt) => attempt + 1);
        });
        return;
      }
    }
    setIssues([]);
    setValidatedStep(undefined);
    try {
      await options.onSave(next);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : 'Could not save this booking link.'
      );
    }
  };
  return {
    draft,
    issues,
    submitError,
    details,
    step,
    validationAttempt,
    slug,
    canGoToStep,
    hasChanges,
    canResetTeamSettings,
    goToStep,
    next,
    back,
    isNew,
    update,
    setDailyLimitEnabled,
    updateBuffers,
    setTitle,
    addDetail,
    removeDetail,
    save,
  };
}
