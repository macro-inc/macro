import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { LessonDefinition, LessonContentProps } from './types';
import { createOnboardingState } from './create-onboarding-state';

const NoopContent = (_props: LessonContentProps) => null;

const createTestLesson = (id: string, order?: number): LessonDefinition => ({
  id,
  title: `Lesson ${id}`,
  subtitle: `Description for ${id}`,
  content: NoopContent,
  order,
});

describe('createOnboardingState', () => {
  describe('initial state', () => {
    it('should start with all lessons incomplete', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        expect(state.lessons().length).toBe(2);
        expect(state.currentIndex()).toBe(0);
        expect(state.isFinished()).toBe(false);
        expect(state.dismissed()).toBe(false);

        dispose();
      });
    });

    it('should sort lessons by order', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [
            createTestLesson('b', 2),
            createTestLesson('a', 1),
            createTestLesson('c', 3),
          ],
        });

        expect(state.lessons()[0].definition.id).toBe('a');
        expect(state.lessons()[1].definition.id).toBe('b');
        expect(state.lessons()[2].definition.id).toBe('c');

        dispose();
      });
    });

    it('should mark initial completed lessons', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
          initialCompleted: new Set(['a']),
        });

        expect(state.lessons()[0].completed).toBe(true);
        expect(state.lessons()[1].completed).toBe(false);
        expect(state.currentIndex()).toBe(1);

        dispose();
      });
    });

    it('should be finished if all initially completed', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
          initialCompleted: new Set(['a', 'b']),
        });

        expect(state.isFinished()).toBe(true);
        expect(state.currentIndex()).toBe(2);
        expect(state.currentLesson()).toBeUndefined();

        dispose();
      });
    });
  });

  describe('currentLesson', () => {
    it('should return the first incomplete lesson', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        expect(state.currentLesson()?.definition.id).toBe('a');

        dispose();
      });
    });

    it('should return undefined when all done', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a')],
        });

        state.completeLesson('a');
        expect(state.currentLesson()).toBeUndefined();

        dispose();
      });
    });
  });

  describe('completeLesson', () => {
    it('should mark a lesson as completed', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.completeLesson('a');

        expect(state.lessons()[0].completed).toBe(true);
        expect(state.currentIndex()).toBe(1);
        expect(state.currentLesson()?.definition.id).toBe('b');

        dispose();
      });
    });

    it('should set isFinished when all completed', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.completeLesson('a');
        state.completeLesson('b');

        expect(state.isFinished()).toBe(true);

        dispose();
      });
    });

    it('should be a no-op for unknown id', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a')],
        });

        state.completeLesson('unknown');
        expect(state.lessons()[0].completed).toBe(false);

        dispose();
      });
    });
  });

  describe('skipLesson', () => {
    it('should mark a lesson as skipped and advance', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.skipLesson('a');

        expect(state.lessons()[0].skipped).toBe(true);
        expect(state.currentIndex()).toBe(1);

        dispose();
      });
    });

    it('should set isFinished when all skipped', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.skipLesson('a');
        state.skipLesson('b');

        expect(state.isFinished()).toBe(true);

        dispose();
      });
    });
  });

  describe('advanceToNext', () => {
    it('should skip the current lesson', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.advanceToNext();

        expect(state.lessons()[0].skipped).toBe(true);
        expect(state.currentLesson()?.definition.id).toBe('b');

        dispose();
      });
    });

    it('should be a no-op when all done', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a')],
        });

        state.completeLesson('a');
        state.advanceToNext();

        expect(state.isFinished()).toBe(true);

        dispose();
      });
    });
  });

  describe('goToLesson', () => {
    it('should un-skip a previously skipped lesson', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a'), createTestLesson('b')],
        });

        state.skipLesson('a');
        expect(state.currentLesson()?.definition.id).toBe('b');

        state.goToLesson(0);
        expect(state.currentLesson()?.definition.id).toBe('a');

        dispose();
      });
    });

    it('should ignore out-of-bounds index', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a')],
        });

        state.goToLesson(-1);
        state.goToLesson(99);
        expect(state.currentLesson()?.definition.id).toBe('a');

        dispose();
      });
    });
  });

  describe('dismiss', () => {
    it('should set dismissed to true', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [createTestLesson('a')],
        });

        state.dismiss();
        expect(state.dismissed()).toBe(true);

        dispose();
      });
    });
  });

  describe('mixed completion and skipping', () => {
    it('should handle mixed complete and skip correctly', () => {
      createRoot((dispose) => {
        const state = createOnboardingState({
          definitions: () => [
            createTestLesson('a'),
            createTestLesson('b'),
            createTestLesson('c'),
          ],
        });

        state.completeLesson('a');
        state.skipLesson('b');

        expect(state.currentLesson()?.definition.id).toBe('c');
        expect(state.isFinished()).toBe(false);

        state.completeLesson('c');
        expect(state.isFinished()).toBe(true);

        dispose();
      });
    });
  });
});
