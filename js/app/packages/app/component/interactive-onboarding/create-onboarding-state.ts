import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { LessonDefinition, LessonId, LessonState } from './types';

interface OnboardingStateOptions {
  definitions: LessonDefinition[];
  initialCompleted?: Set<LessonId>;
}

export function createOnboardingState(options: OnboardingStateOptions) {
  const sorted = [...options.definitions].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );

  const [store, setStore] = createStore<LessonState[]>(
    sorted.map((def, index) => ({
      definition: def,
      index,
      completed: options.initialCompleted?.has(def.id) ?? false,
      skipped: false,
    }))
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
    dismiss,
  };
}

export type OnboardingState = ReturnType<typeof createOnboardingState>;
