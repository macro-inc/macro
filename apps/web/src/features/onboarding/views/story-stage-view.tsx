import type { JSX } from 'solid-js';
import { StoryStage } from '../components/story-stage';
import { useOnboardingContext } from '../context/onboarding-context';
import type { StoryStep } from '../core/steps';
import { createWorkspaceAccent } from '../primitives/workspace-accent';

/** The opening slides with the persisted accent and the trust slide's star count. */
export function StoryStageView(props: {
  step: StoryStep;
  onNext: (features?: string[]) => void;
  onWorkspaceContinue: (color: string) => void;
  children?: JSX.Element;
}) {
  const context = useOnboardingContext();
  const workspaceAccent = createWorkspaceAccent();
  const githubStars = context.createGithubStars();
  return (
    <StoryStage
      step={props.step}
      accent={workspaceAccent.accent()}
      githubStars={githubStars()}
      onSelectAccent={workspaceAccent.select}
      onNext={props.onNext}
      onWorkspaceContinue={props.onWorkspaceContinue}
    >
      {props.children}
    </StoryStage>
  );
}
