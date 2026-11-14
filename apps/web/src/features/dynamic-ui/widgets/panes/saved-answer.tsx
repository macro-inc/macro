import { AppAnswerDisplay } from '@app/features/database-query/answer-display';
import type {
  QueryAnswer,
  QueryFailure,
} from '@app/features/database-query/core/query';
import { queryErrorMessage } from '@app/features/database-query/core/query';
import { createSavedQuestionSource } from '@app/features/database-query/queries/app-query-source';
import { usePending } from '@app/observability/flow';
import { type Accessor, type JSX, Match, Switch } from 'solid-js';
import { match } from 'ts-pattern';
import { NO_ACCESS_CODES, NoAccess, PaneLoading, PaneMessage } from './pane';

/**
 * Whether a saved question failed because its viewer can't read it: the
 * service hides a question the viewer may not read behind 404, and the
 * databases it reads may be forbidden or gone.
 */
export function isNoAccess(failure: QueryFailure): boolean {
  return match(failure)
    .with({ kind: 'question' }, { kind: 'databases' }, ({ error }) =>
      NO_ACCESS_CODES.includes(error.code)
    )
    .otherwise(() => false);
}

/**
 * A saved question's live answer, run in the browser as the viewer like a
 * document's live answer, and kept current as the tables it read change.
 * Draws the answer with `children`, or what stands in for it.
 */
export function SavedAnswer(props: AnswerProps) {
  return (
    <AppAnswerDisplay>
      <Answer {...props} />
    </AppAnswerDisplay>
  );
}

type AnswerProps = {
  queryId: string;
  dense: boolean;
  /** Draws the answer, which a rerun replaces in place. */
  children: (answer: Accessor<QueryAnswer>) => JSX.Element;
  /** Frames what stands in for the answer, for a pane whose answer brings its own frame. */
  frame?: (content: JSX.Element) => JSX.Element;
};

function Answer(props: AnswerProps) {
  const source = createSavedQuestionSource(() => props.queryId);
  usePending(
    'dynamic_ui.pane.load',
    () => source.loading() && !source.answer()
  );
  const failure = () => (source.answer() ? undefined : source.error());
  const framed = (content: JSX.Element) =>
    props.frame ? props.frame(content) : content;
  return (
    <Switch fallback={framed(<PaneLoading dense={props.dense} />)}>
      <Match when={failure()}>
        {(failed) =>
          framed(
            <Switch
              fallback={
                <PaneMessage dense={props.dense}>
                  {queryErrorMessage(failed(), false)}
                </PaneMessage>
              }
            >
              <Match when={isNoAccess(failed())}>
                <NoAccess dense={props.dense} />
              </Match>
            </Switch>
          )
        }
      </Match>
      <Match when={source.answer()}>{(answer) => props.children(answer)}</Match>
    </Switch>
  );
}
