import {
  createSignal,
  lazy,
  Match,
  onCleanup,
  onMount,
  Switch,
} from 'solid-js';
import { homepageChatData } from '../../core/homepage-demo-content';
import {
  HOMEPAGE_DEMO_EVENT,
  type HomepageDemoView,
  isHomepageDemoView,
} from '../../core/homepage-demo-scenes';
import DummyWorkspace from '../workspace/DummyWorkspace';
import './homepage-scenes.css';

const Documents = lazy(async () => ({
  default: (await import('../documents/DocumentProjectDemo'))
    .DocumentProjectDemo,
}));
const Agents = lazy(async () => ({
  default: (await import('../agents/AgentWorkflowStories')).AgentMeetingStory,
}));
const Crm = lazy(() => import('./CrmPipelineScene'));

/** Each view reuses the corresponding native-style product demo, with local data. */
export default function HomepageScene(props: { initialView?: string } = {}) {
  const [view, setView] = createSignal<HomepageDemoView>(
    isHomepageDemoView(props.initialView) ? props.initialView : 'Inbox'
  );
  onMount(() => {
    const select = (event: Event) => {
      if ('detail' in event && isHomepageDemoView(event.detail))
        setView(event.detail);
    };
    window.addEventListener(HOMEPAGE_DEMO_EVENT, select);
    onCleanup(() => window.removeEventListener(HOMEPAGE_DEMO_EVENT, select));
  });
  return (
    <div
      data-homepage-demo
      data-homepage-scene={view()}
      class={`homepage-scene homepage-scene-${view().toLowerCase()}`}
    >
      <Switch>
        <Match when={view() === 'Inbox'}>
          <DummyWorkspace embedded />
        </Match>
        <Match when={view() === 'Chat'}>
          <DummyWorkspace
            initialView="messages"
            initialData={homepageChatData()}
            embedded
          />
        </Match>
        <Match when={view() === 'Docs'}>
          <DummyWorkspace
            initialView="documents"
            demoTitle="Website brief"
            embedded
            demoContent={<Documents />}
          />
        </Match>
        <Match when={view() === 'CRM'}>
          <DummyWorkspace
            initialView="crm"
            embedded
            demoIncludesSidebar
            demoContent={<Crm />}
          />
        </Match>
        <Match when={view() === 'Tasks'}>
          <DummyWorkspace tasksShowcase embedded />
        </Match>
        <Match when={view() === 'Agents'}>
          <DummyWorkspace
            initialView="agents"
            demoTitle="Tomorrow’s meetings"
            embedded
            demoContent={<Agents />}
          />
        </Match>
      </Switch>
    </div>
  );
}
