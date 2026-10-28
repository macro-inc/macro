/** Forms UI loads only when an enabled Forms tool appears in the transcript. */
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableForms, isFeatureEnabled } from '@core/constant/featureFlags';
import { lazy, Show, Suspense } from 'solid-js';
import type {
  RenderContext,
  ToolHandler,
  ToolHandlerMap,
} from './ToolRenderer';

const names = [
  'CreateForm',
  'ReadForm',
  'EditForm',
  'ListForms',
  'SetFormAccess',
] as const;
type Name = (typeof names)[number];
export type FormToolHandlerMap = Pick<ToolHandlerMap<RenderContext>, Name>;
function handler<N extends Name>(name: N): ToolHandler<N, RenderContext> {
  const Render = lazy(async () => ({
    default: (await import('./Forms')).formsToolHandlers[name].render,
  }));
  return {
    render: (props) => {
      const enabled = useFeatureFlag(enableForms);
      return (
        <Show
          when={enabled().enabled}
          fallback={
            <span class="text-xs text-ink-muted">
              Forms is not enabled for this account.
            </span>
          }
        >
          <Suspense
            fallback={<span class="text-xs text-ink-muted">Form tool</span>}
          >
            <Render {...props} />
          </Suspense>
        </Show>
      );
    },
    handleResponse: async (context) => {
      if (isFeatureEnabled(enableForms))
        await (await import('./Forms')).formsToolHandlers[
          name
        ].handleResponse?.(context);
    },
  };
}
export const lazyFormsToolHandlers = Object.fromEntries(
  names.map((name) => [name, handler(name)])
) as Pick<ToolHandlerMap<RenderContext>, Name>;
