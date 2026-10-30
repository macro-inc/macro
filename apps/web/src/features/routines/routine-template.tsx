import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { ForwardToChannel } from '@core/component/ForwardToChannel';
import { toast } from '@core/component/Toast/Toast';
import {
  enableRoutineSharing,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useEmail, useUserId } from '@core/context/user';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { getDefaultTimezone } from '@core/util/cron';
import { writeClipboardData } from '@core/util/dataTransfer';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { Telemetry } from '@macro-inc/observability';
import type {
  ActionTrigger,
  RoutineTemplate,
  TemplateVariable,
} from '@service-scheduled-action/generated/schemas';
import { type ManagedDialogProps, openDialog } from '@ui';
import {
  type Accessor,
  type ComponentProps,
  createEffect,
  createSignal,
  getOwner,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { TemplateCard } from './components/template-card';
import { describeTrigger } from './core/routine-triggers';
import type { Activator } from './core/template';
import {
  createTemplateActivation,
  templatePrompt,
} from './primitives/template-activation';
import { parseRoutineTriggers } from './queries/routine-trigger-mapping';
import {
  publishRoutineTemplate,
  useActivateTemplateMutation,
  useReferenceAccess,
  useRoutineTemplateQuery,
  useUnshareTemplateMutation,
} from './queries/templates';
import { RoutinePromptEditor } from './routine-prompt-editor';
import { ActivateTemplateDialog } from './views/activate-template-dialog';
import { RoutineTemplateView } from './views/routine-template-view';
import { ShareRoutineDialog } from './views/share-template-dialog';

function triggerLines(trigger: ActionTrigger): string[] {
  return (parseRoutineTriggers(trigger) ?? []).map(describeTrigger);
}

function ReadOnlyInstructions(props: { prompt: string }) {
  return (
    <Show when={{ prompt: props.prompt }} keyed>
      {(current) => (
        <RoutinePromptEditor
          initialValue={current.prompt}
          disabled
          onChange={() => {}}
        />
      )}
    </Show>
  );
}

function useActivator(): Accessor<Activator | undefined> {
  const userId = useUserId();
  const email = useEmail();
  return () => {
    const id = userId();
    const address = email();
    if (!id || !address) return undefined;
    return {
      userId: id,
      email: address,
      displayName: getDisplayName(tryMacroId(id)) || undefined,
      timezone: getDefaultTimezone(),
    };
  };
}

function itemReferences(variables: readonly TemplateVariable[]) {
  return variables.flatMap((variable) =>
    variable.kind === 'item'
      ? [{ id: variable.id, blockName: variable.block_name }]
      : []
  );
}

/** Activating a shared template as the viewer's own routine. */
function ActivateTemplate(
  props: ManagedDialogProps & {
    template: RoutineTemplate;
    onActivated(routineId: string): void;
  }
) {
  const activator = useActivator();
  const access = useReferenceAccess(() =>
    itemReferences(props.template.variables)
  );
  const activation = createTemplateActivation({
    template: () => props.template,
    activator,
    access,
  });
  const mutation = useActivateTemplateMutation();
  const [error, setError] = createSignal<string>();

  async function activate() {
    const body = activation.request();
    if (!body) return;
    setError(undefined);
    await Telemetry.span('routine.template.activate', async (span) => {
      span.setAttr('routine.template_id', props.template.id);
      span.setAttr(
        'routine.template.variables',
        props.template.variables.length
      );
      try {
        const routine = await mutation.mutateAsync({
          templateId: props.template.id,
          body,
        });
        if (!routine.id) throw new Error('Activated routine has no ID');
        span.setAttr('routine.id', routine.id);
        props.onOpenChange(false);
        props.onActivated(routine.id);
      } catch (cause) {
        span.error('Template activation failed');
        setError(
          cause instanceof Error && cause.message
            ? cause.message
            : 'Could not activate the routine. Please try again.'
        );
      }
    });
  }

  return (
    <ActivateTemplateDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      name={props.template.name}
      authorName={
        getDisplayName(tryMacroId(props.template.author)) || 'its author'
      }
      triggers={triggerLines(props.template.trigger)}
      instructions={<ReadOnlyInstructions prompt={activation.prompt()} />}
      references={activation.references()}
      choices={activation.choices()}
      onChoose={activation.choose}
      undecided={activation.undecided().length}
      pending={mutation.isPending}
      error={error()}
      onActivate={() => fireAndForget(activate(), 'routines')}
    />
  );
}

/** Opens activation for a template; `onActivated` gets the new routine. */
export function openActivateTemplateDialog(
  template: RoutineTemplate,
  owner: ReturnType<typeof getOwner>,
  onActivated: (routineId: string) => void
) {
  if (!isFeatureEnabled(enableRoutineSharing)) return;
  return openDialog<ComponentProps<typeof ActivateTemplate>>(
    (props) => {
      const sharing = useFeatureFlag(enableRoutineSharing);
      createEffect(
        on(sharing, (flag) => {
          if (!flag.loading && !flag.enabled) props.onOpenChange(false);
        })
      );
      return (
        <Show when={sharing().enabled}>
          <ActivateTemplate {...props} />
        </Show>
      );
    },
    {
      template,
      onActivated: (routineId) => {
        toast.success('Routine activated');
        onActivated(routineId);
      },
    },
    { owner, key: `activate-template-${template.id}` }
  );
}

/**
 * A shared routine as people other than its owner see it: its template, with
 * a way to activate their own copy.
 */
export function RoutineTemplatePage(props: {
  scheduleId: string;
  onBack(): void;
}) {
  const sharing = useFeatureFlag(enableRoutineSharing);
  return (
    <Show
      when={sharing().enabled}
      fallback={
        <div class="flex size-full items-center justify-center p-3 text-center text-sm text-ink-muted">
          {sharing().loading ? 'Loading…' : 'Routine sharing is unavailable.'}
        </div>
      }
    >
      <EnabledRoutineTemplatePage {...props} />
    </Show>
  );
}

function EnabledRoutineTemplatePage(props: {
  scheduleId: string;
  onBack(): void;
}) {
  const owner = getOwner();
  const layout = useSplitLayout();
  const userId = useUserId();
  const query = useRoutineTemplateQuery(() => props.scheduleId);
  const template = () => (query.isSuccess ? query.data : undefined);
  const access = useReferenceAccess(() =>
    itemReferences(template()?.variables ?? [])
  );
  const activator = useActivator();

  const openActivation = (current: RoutineTemplate) =>
    openActivateTemplateDialog(current, owner, (routineId) =>
      openAgentsPage(layout, 'routines', { routineId })
    );

  return (
    <Switch
      fallback={
        <div class="flex size-full items-center justify-center p-3 text-sm text-ink-muted">
          Loading…
        </div>
      }
    >
      <Match when={query.isError}>
        <div class="flex size-full items-center justify-center p-3 text-sm text-ink-muted">
          Unable to load this routine. Please try again.
        </div>
      </Match>
      <Match when={query.isSuccess && !template()}>
        <div class="flex size-full items-center justify-center p-3 text-center text-sm text-ink-muted">
          This routine belongs to someone else and isn't shared as a template.
        </div>
      </Match>
      <Match when={template()}>
        {(current) => {
          const activation = createTemplateActivation({
            template: current,
            activator,
            access,
          });
          return (
            <RoutineTemplateView
              template={current()}
              authorName={
                getDisplayName(tryMacroId(current().author)) || 'Someone'
              }
              canActivate={current().author !== userId()}
              triggers={triggerLines(current().trigger)}
              references={activation.references()}
              instructions={
                <ReadOnlyInstructions prompt={templatePrompt(current())} />
              }
              onActivate={() => openActivation(current())}
              onBack={props.onBack}
            />
          );
        }}
      </Match>
    </Switch>
  );
}

/** A routine as a mention in a message, which renders its template card. */
function routineReference(routineId: string, name: string) {
  const data = JSON.stringify({
    documentId: routineId,
    documentName: name,
    blockName: 'routine',
  });
  return {
    markdown: `<m-document-mention>${data}</m-document-mention>`,
    mention: { entity_type: 'automation', entity_id: routineId },
  };
}

/** The owner's Share menu for one of their routines. */
function ShareRoutine(
  props: ManagedDialogProps & { routineId: string; name: string }
) {
  const query = useRoutineTemplateQuery(() => props.routineId);
  const template = () => (query.isPending ? undefined : (query.data ?? null));
  const unshare = useUnshareTemplateMutation();
  const [publishing, setPublishing] = createSignal(false);
  const [sendForm, setSendForm] = createSignal<{
    canSubmit(): boolean;
    submit(): void;
  }>();

  // Every send and copy publishes the routine's current setup first.
  async function publish(source: 'send' | 'link') {
    setPublishing(true);
    try {
      await Telemetry.span('routine.template.share', async (span) => {
        span.setAttr('routine.id', props.routineId);
        span.setAttr('routine.template.source', source);
        try {
          await publishRoutineTemplate(props.routineId);
        } catch (cause) {
          span.error('Sharing the routine failed');
          throw cause;
        }
      });
    } finally {
      setPublishing(false);
    }
  }

  async function copyLink() {
    try {
      await publish('link');
    } catch {
      toast.failure('Could not share this routine');
      return;
    }
    const url = buildSimpleEntityUrl({ type: 'routine', id: props.routineId });
    if (await writeClipboardData({ 'text/plain': url }))
      toast.success('Link copied', {
        subtext: 'Anyone with the link can activate their own copy.',
      });
    else toast.alert('Could not copy the link');
  }

  async function stopSharing() {
    try {
      await unshare.mutateAsync({ scheduleId: props.routineId });
      toast.success('Stopped sharing');
    } catch {
      toast.failure('Could not stop sharing', { subtext: 'Please try again' });
    }
  }

  return (
    <ShareRoutineDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      name={props.name}
      template={template()}
      pending={publishing() || unshare.isPending}
      onCopyLink={() => fireAndForget(copyLink(), 'routines')}
      onStopSharing={() => fireAndForget(stopSharing(), 'routines')}
      sendAction={sendForm()}
      send={
        <ForwardToChannel
          name={props.name}
          entity={{ entity_type: 'automation', entity_id: props.routineId }}
          inlineReference={routineReference(props.routineId, props.name)}
          prepareChannel={() => publish('send')}
          onSubmit={() => props.onOpenChange(false)}
          onCancel={() => props.onOpenChange(false)}
          ref={(form) =>
            setSendForm({
              canSubmit: form.canSubmit,
              submit: form.handleSubmit,
            })
          }
        />
      }
    />
  );
}

/** Opens the Share menu for a routine the viewer owns. */
export function openShareRoutineDialog(
  routine: { routineId: string; name: string },
  owner: ReturnType<typeof getOwner>
) {
  if (!isFeatureEnabled(enableRoutineSharing)) return;
  return openDialog<ComponentProps<typeof ShareRoutine>>(
    (props) => {
      const sharing = useFeatureFlag(enableRoutineSharing);
      createEffect(
        on(sharing, (flag) => {
          if (!flag.loading && !flag.enabled) props.onOpenChange(false);
        })
      );
      return (
        <Show when={sharing().enabled}>
          <ShareRoutine {...props} />
        </Show>
      );
    },
    routine,
    {
      owner,
      key: `share-template-${routine.routineId}`,
    }
  );
}

/**
 * The card under a message that mentions a shared routine. Nothing renders
 * for a routine that isn't shared as a template.
 */
export function RoutineTemplateCard(props: { routineId: string }) {
  const owner = getOwner();
  const layout = useSplitLayout();
  const userId = useUserId();
  const query = useRoutineTemplateQuery(() => props.routineId);
  const open = (routineId: string) =>
    openAgentsPage(layout, 'routines', { routineId });
  return (
    <Show when={query.isSuccess ? query.data : undefined}>
      {(template) => (
        <TemplateCard
          name={template().name}
          description={template().description}
          authorName={
            getDisplayName(tryMacroId(template().author)) || 'Someone'
          }
          triggers={triggerLines(template().trigger)}
          activeCount={template().active_count}
          canActivate={template().author !== userId()}
          onView={() => open(template().id)}
          onActivate={() => openActivateTemplateDialog(template(), owner, open)}
        />
      )}
    </Show>
  );
}
