import type { LessonId } from './types';

const STORAGE_KEY = 'macro:onboarding:completed';

export function loadCompletedLessons(): Set<LessonId> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

export function saveCompletedLesson(id: LessonId): void {
  const current = loadCompletedLessons();
  current.add(id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...current]));
}

export function clearCompletedLessons(): void {
  localStorage.removeItem(STORAGE_KEY);
}
