import { Match, Switch } from 'solid-js';
import type { BenefitScene } from '../../core/benefit-pages';
import { DemoInteractionBoundary } from '../DemoInteractionBoundary';
import { DocumentReferencesDemo } from '../documents/DocumentReferencesDemo';
import { PaperEmailSource } from '../paper/PaperEmailSource';
import { PaperFeatureGraphic } from '../paper/PaperFeatureGraphic';
import { GithubConversationDemo } from '../reviews/GithubWorkflow';
import { wallpapers } from '../TutorialWallpaper';
import { LinkedTasksDemo } from './LinkedTasksDemo';

export type CompanyGraphScene =
  | 'pr-channel'
  | 'task-email'
  | 'references'
  | 'task-task';
export function isCompanyGraphScene(
  scene: BenefitScene
): scene is CompanyGraphScene {
  return (
    scene === 'pr-channel' ||
    scene === 'task-email' ||
    scene === 'references' ||
    scene === 'task-task'
  );
}

export function CompanyGraphDemo(props: { scene: CompanyGraphScene }) {
  return (
    <Switch>
      <Match when={props.scene === 'task-email'}>
        <div style={{ '--email-source-accent': wallpapers.mail.colors[1] }}>
          <PaperFeatureGraphic
            label="Create a task from email. The Source property keeps a link to the original Contract redlines thread."
            mobileHeight={544}
            backdrop={false}
          >
            <PaperEmailSource />
          </PaperFeatureGraphic>
        </div>
      </Match>
      <Match when={props.scene === 'pr-channel'}>
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <GithubConversationDemo previewChanges={false} />}
        />
      </Match>
      <Match when={props.scene === 'references'}>
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <DocumentReferencesDemo mobileHeight={300} />}
        />
      </Match>
      <Match when={props.scene === 'task-task'}>
        <DemoInteractionBoundary
          class="feature-page-visual"
          render={() => <LinkedTasksDemo />}
        />
      </Match>
    </Switch>
  );
}
