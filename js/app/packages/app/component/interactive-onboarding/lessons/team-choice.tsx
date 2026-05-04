import { createEffect } from 'solid-js';
import UsersIcon from '@icon/regular/users.svg';
import UserIcon from '@icon/regular/user.svg';
import ArrowLeftIcon from '@icon/regular/arrow-left.svg';
import type { LessonContentProps, LessonDefinition } from '../types';

function TeamChoiceContent() {
  return (
    <div class="flex flex-col gap-3 onboarding-stagger">
      <p>Choose how you want to use Macro.</p>
    </div>
  );
}

function TeamChoiceDemo(props: LessonContentProps) {
  createEffect(() => {
    props.onUnready();
  });

  const handleBack = () => {
    props.goToLesson('choose-plan');
  };

  const handleChooseTeam = () => {
    props.advance();
  };

  const handleChooseSolo = () => {
    props.skipLesson('invite-team');
    props.advance();
  };

  return (
    <div class="h-full w-full flex flex-col p-12">
      <button
        type="button"
        onClick={handleBack}
        class="flex items-center gap-1.5 text-sm text-ink/50 hover:text-ink bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 rounded-xs w-fit mb-auto"
      >
        <ArrowLeftIcon class="size-4" />
        Back
      </button>
      <div class="flex-1 flex items-center justify-center">
        <div class="flex flex-col gap-4 w-full max-w-md">
          <button
            type="button"
            onClick={handleChooseTeam}
            class="flex items-center gap-4 p-5 rounded-md border border-accent/50 bg-accent/5 hover:bg-accent/10 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            <div class="shrink-0 size-11 rounded-full bg-accent/20 flex items-center justify-center">
              <UsersIcon class="size-5 text-accent" />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-base font-semibold text-ink">
                Create a team
              </span>
              <span class="text-sm text-ink/50">
                Collaborate with others in a shared workspace
              </span>
            </div>
          </button>

          <button
            type="button"
            onClick={handleChooseSolo}
            class="flex items-center gap-4 p-5 rounded-md border border-edge bg-panel hover:bg-ink/5 text-left bracket-never focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-panel"
          >
            <div class="shrink-0 size-11 rounded-full bg-ink/10 flex items-center justify-center">
              <UserIcon class="size-5 text-ink/60" />
            </div>
            <div class="flex flex-col gap-0.5">
              <span class="text-base font-medium text-ink">Continue solo</span>
              <span class="text-sm text-ink/50">
                Use Macro on your own for now
              </span>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

export const teamChoiceLesson: LessonDefinition = {
  id: 'team-choice',
  title: 'Set up your team',
  content: TeamChoiceContent,
  demo: TeamChoiceDemo,
  order: 89,
  hideContinue: true,
};
