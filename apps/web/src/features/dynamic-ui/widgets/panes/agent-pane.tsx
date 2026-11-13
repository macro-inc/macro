import { t } from '@app/lib/i18n';
import { TraceFlow } from '@app/observability/flow';
import { type JSX, type ParentProps, Show, Suspense } from 'solid-js';
import { useScopedAgentId } from '../../context/agent-scope';
import {
  DashboardsOnly,
  Pane,
  PaneLoading,
  PaneMessage,
  WhenVisible,
} from './pane';

export type AgentPaneType = 'sessions' | 'activity' | 'routines' | 'spend';

/**
 * An agent pane: gated by the flag, loaded when scrolled to, traced as its
 * own phase (`dynamic_ui.pane.<type>`) of the view loading it, and framed
 * like every data pane. The agent comes from the widget or the view's scope;
 * a pane with neither says so. Attributes are opaque ids, never content.
 */
export function AgentPane(props: {
  type: AgentPaneType;
  agentId: string | undefined;
  title: string;
  dense: boolean;
  trailing?: JSX.Element;
  attributes?: Record<string, string>;
  children: (agentId: string) => JSX.Element;
}) {
  const agentId = useScopedAgentId(() => props.agentId);
  return (
    <DashboardsOnly>
      <Pane
        title={props.title}
        label={props.title}
        dense={props.dense}
        trailing={props.trailing}
      >
        <Show
          when={agentId()}
          keyed
          fallback={
            <PaneMessage dense={props.dense}>
              {t('dynamicUi.noAgent')}
            </PaneMessage>
          }
        >
          {(id) => (
            <WhenVisible dense={props.dense}>
              <TraceFlow
                name={`dynamic_ui.pane.${props.type}`}
                // A pane pointed at another agent or source loads anew.
                key={() => JSON.stringify([id, props.attributes])}
                attributes={{
                  'pane.type': props.type,
                  ...props.attributes,
                }}
              >
                <Suspense fallback={<PaneLoading dense={props.dense} />}>
                  {props.children(id)}
                </Suspense>
              </TraceFlow>
            </WhenVisible>
          )}
        </Show>
      </Pane>
    </DashboardsOnly>
  );
}

/** A pane body that scrolls inside its frame when it outgrows it. */
export function PaneScroll(props: ParentProps) {
  return (
    <div class="-mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1">
      {props.children}
    </div>
  );
}
