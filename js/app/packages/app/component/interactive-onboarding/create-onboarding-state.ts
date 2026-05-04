import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import type { LessonDefinition, LessonId, LessonState } from './types';

interface OnboardingStateOptions {
  definitions: Accessor<LessonDefinition[]>;
  initialCompleted?: Set<LessonId>;
}

export function createOnboardingState(options: OnboardingStateOptions) {
  const sortDefinitions = (defs: LessonDefinition[]) =>
    [...defs].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const buildLessonStates = (
    defs: LessonDefinition[],
    existingStates?: LessonState[]
  ): LessonState[] => {
    const sorted = sortDefinitions(defs);
    const existingById = new Map(
      existingStates?.map((s) => [s.definition.id, s])
    );

    return sorted.map((def, index) => {
      const existing = existingById.get(def.id);
      return {
        definition: def,
        index,
        completed:
          existing?.completed ?? options.initialCompleted?.has(def.id) ?? false,
        skipped: existing?.skipped ?? false,
      };
    });
  };

  const [store, setStore] = createStore<LessonState[]>(
    buildLessonStates(options.definitions())
  );

  createEffect(
    on(options.definitions, (defs) => {
      setStore(reconcile(buildLessonStates(defs, store)));
    })
  );

  const [dismissed, setDismissed] = createSignal(false);

  const lessons = () => store;

  const currentIndex = () => {
    const idx = store.findIndex((l) => !l.completed && !l.skipped);
    return idx === -1 ? store.length : idx;
  };

  const currentLesson = () => {
    const idx = currentIndex();
    return idx < store.length ? store[idx] : undefined;
  };

  const isFinished = () =>
    store.length > 0 && store.every((l) => l.completed || l.skipped);

  const findIndexById = (id: LessonId): number =>
    store.findIndex((l) => l.definition.id === id);

  const completeLesson = (id: LessonId) => {
    const idx = findIndexById(id);
    if (idx !== -1) setStore(idx, 'completed', true);
  };

  const skipLesson = (id: LessonId) => {
    const idx = findIndexById(id);
    if (idx !== -1) setStore(idx, 'skipped', true);
  };

  const advanceToNext = () => {
    const current = currentLesson();
    if (current) {
      skipLesson(current.definition.id);
    }
  };

  const goToLesson = (index: number) => {
    if (index < 0 || index >= store.length) return;
    setStore(index, 'skipped', false);
  };

  const goToLessonById = (id: LessonId) => {
    const idx = findIndexById(id);
    if (idx !== -1) {
      // Reset target lesson and all lessons after it
      for (let i = idx; i < store.length; i++) {
        setStore(i, 'skipped', false);
        setStore(i, 'completed', false);
      }
    }
  };

  const dismiss = () => {
    setDismissed(true);
  };

  return {
    lessons,
    currentIndex,
    currentLesson,
    isFinished,
    dismissed,
    completeLesson,
    skipLesson,
    advanceToNext,
    goToLesson,
    goToLessonById,
    dismiss,
  };
}

export type OnboardingState = ReturnType<typeof createOnboardingState>;
