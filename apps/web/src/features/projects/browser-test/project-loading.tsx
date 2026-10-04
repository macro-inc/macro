import '@app/index.css';
import { createResource, Show, Suspense } from 'solid-js';
import { render } from 'solid-js/web';
import {
  ProjectContentSkeleton,
  ProjectDescriptionSkeleton,
} from '../components/project-skeletons';

// A deliberately pending resource keeps the actual Suspense fallback visible.
// Narrow previews apply the same touch variant used by the production layout.
const mobile = new URLSearchParams(location.search).has('mobile');
const description = new URLSearchParams(location.search).has('description');
const section = new URLSearchParams(location.search).has('tasks')
  ? 'tasks'
  : 'overview';
document.documentElement.dataset.touchDevice = String(mobile);

function PendingProject() {
  const [content] = createResource(() => new Promise<string>(() => {}));
  return <>{content()}</>;
}

render(
  () => (
    <main
      class="bg-page text-ink h-screen max-w-full"
      style={{ width: mobile ? '390px' : '1100px' }}
    >
      <Show
        when={description}
        fallback={
          <Suspense fallback={<ProjectContentSkeleton section={section} />}>
            <PendingProject />
          </Suspense>
        }
      >
        <div class="px-6 pt-12 touch:pt-6">
          <div class="mx-auto max-w-3xl">
            <h1 class="mb-8 text-2xl font-semibold">
              Project description preview
            </h1>
            <Suspense fallback={<ProjectDescriptionSkeleton />}>
              <PendingProject />
            </Suspense>
            <p class="mt-4 text-xs text-ink-muted">Discussion</p>
          </div>
        </div>
      </Show>
    </main>
  ),
  document.getElementById('root')!
);
