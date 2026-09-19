import { isValidTeamTaskSlug } from '@app/features/settings/teamSlug';
import { useIsAuthenticated } from '@core/auth';
import { LoadingBlock } from '@core/component/LoadingBlock';
import { setPostLoginRedirect } from '@core/util/postLoginRedirect';
import { thrownResultErrorHasCode } from '@core/util/result';
import { useTeamTaskQuery } from '@queries/storage/team-task';
import { Navigate, useNavigate, useParams } from '@solidjs/router';
import { Button } from '@ui';
import { createEffect, createMemo, Match, on, Show, Switch } from 'solid-js';

type TaskRouteParams = {
  taskSlug: string;
};

/** Resolves a team-scoped task slug to the existing canonical task route. */
export function TaskRoute() {
  const params = useParams<TaskRouteParams>();
  const navigate = useNavigate();
  const isAuthenticated = useIsAuthenticated();
  const taskSlug = () => params.taskSlug;
  const isValidSlug = () => isValidTeamTaskSlug(taskSlug());
  const slugToResolve = createMemo(() =>
    isAuthenticated() === true && isValidSlug() ? taskSlug() : undefined
  );
  const taskQuery = useTeamTaskQuery(slugToResolve);
  const documentId = () => taskQuery.data?.documentMetadata.documentId;
  // FORBIDDEN covers a user who is not part of a Macro team yet; to them the
  // reference is just as unavailable as a slug that does not resolve.
  const taskNotFound = () =>
    thrownResultErrorHasCode(taskQuery.error, 'NOT_FOUND') ||
    thrownResultErrorHasCode(taskQuery.error, 'FORBIDDEN');

  // A GitHub autolink may be opened before the user has signed in. Preserve
  // the full URL so BasePathComponent can restore it after authentication.
  createEffect(
    on(isAuthenticated, (authenticated) => {
      if (authenticated !== false) return;
      setPostLoginRedirect(window.location.href);
      navigate('/login', { replace: true });
    })
  );

  return (
    <Switch fallback={<LoadingBlock />}>
      <Match when={isAuthenticated() !== true}>
        <LoadingBlock />
      </Match>
      <Match when={!isValidSlug()}>
        <TaskRouteError notFound />
      </Match>
      <Match when={documentId()}>
        {(id) => <Navigate href={`/task/${id()}`} />}
      </Match>
      <Match when={taskQuery.isError && !taskQuery.isFetching}>
        <TaskRouteError
          notFound={taskNotFound()}
          onRetry={() => void taskQuery.refetch()}
        />
      </Match>
      <Match when={taskQuery.isSuccess}>
        <TaskRouteError
          notFound={false}
          onRetry={() => void taskQuery.refetch()}
        />
      </Match>
    </Switch>
  );
}

function TaskRouteError(props: { notFound: boolean; onRetry?: () => void }) {
  const navigate = useNavigate();

  return (
    <div class="size-full flex items-center justify-center p-8">
      <div class="flex max-w-sm flex-col items-center gap-4 text-center">
        <h1 class="text-lg font-medium text-ink">
          {props.notFound ? 'Task not found' : 'Unable to open task'}
        </h1>
        <p class="text-sm text-ink-muted">
          {props.notFound
            ? 'This task reference does not exist or is not available to your team.'
            : 'Something went wrong while resolving this task reference.'}
        </p>
        <div class="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/tasks')}
          >
            Go to tasks
          </Button>
          <Show when={!props.notFound && props.onRetry}>
            {(onRetry) => (
              <Button variant="outline" size="sm" onClick={onRetry()}>
                Try again
              </Button>
            )}
          </Show>
        </div>
      </div>
    </div>
  );
}
