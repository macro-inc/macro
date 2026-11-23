import {
  describeGatedThings,
  GatedOperationList,
  gatedFocus,
  permissionRequestParts,
  useAgentPermissionsFlag,
  useOpenAgentPermissions,
  useSessionToolPermissionsQuery,
} from '@app/features/agent-permissions';
import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import type { ToolApprovalAnswerDto } from '@service-agent-harness/generated/schemas';
import { Button } from '@ui';
import { createMemo, createSignal, Show } from 'solid-js';
import { useOptionalAgentSession } from '../context/AgentSessionContext';
import type { HeldToolApproval } from '../primitives/create-tool-approval-controller';
import {
  type PermissionHold,
  parsePermissionHold,
} from '../state/permission-approval';
import { PermissionRequestCard } from '../ui/PermissionRequestCard';

/**
 * A program held because operations it may call are set to Ask, docked
 * above the composer: the person it acts for allows it once, for the
 * session, or denies it. Everyone else waits, and may cancel. Answered, the
 * card goes; the program's own row in the transcript says what happened.
 */
export function PermissionApprovalRequest(props: {
  request: HeldToolApproval;
}) {
  const session = useOptionalAgentSession();
  const approvals = () => session?.toolApprovals;
  // The hold stays answerable whatever the flag says (a run waits on it), but
  // the link to the agent's permissions reads them only with the flag on.
  const permissionsFlag = useAgentPermissionsFlag();
  const permissionsQuery = useSessionToolPermissionsQuery(
    () => session?.sessionId() ?? '',
    () => permissionsFlag() && Boolean(session?.sessionId())
  );
  const openPermissions = useOpenAgentPermissions();

  // The pending request carries no arguments; its transcript part does.
  const hold = createMemo(() => {
    for (const message of session?.messages() ?? []) {
      for (const part of message.parts) {
        if (
          part.kind === 'tool_approval' &&
          part.approvalId === props.request.approvalId
        ) {
          return parsePermissionHold(part.arguments);
        }
      }
    }
    return undefined;
  });
  const operations = () => hold()?.operations ?? [];

  const agent = () =>
    session?.bot()?.name ?? t('agentPermissionsChat.theAgent');
  const approverId = () =>
    props.request.approver ?? session?.session()?.ownerId ?? undefined;
  const approverName = () => {
    const id = approverId();
    return id
      ? (session?.displayName(id) ?? id)
      : t('agentPermissionsChat.theApprover');
  };
  const view = () =>
    permissionsQuery.isSuccess
      ? (permissionsQuery.data ?? undefined)
      : undefined;

  const waitingDescription = () =>
    operations().length > 0
      ? t('agentPermissionsChat.wantsToWithAccess', {
          agent: agent(),
          things: describeGatedThings(operations()),
          name: approverName(),
        })
      : t('agentPermissionsChat.wantsToRunWithAccess', {
          agent: agent(),
          name: approverName(),
        });

  const answer = (value: ToolApprovalAnswerDto) =>
    fireAndForget(
      approvals()?.answer(props.request.approvalId, value),
      'agent-interactions'
    );
  const openSettings = () => {
    const agentId = view()?.agentId;
    if (agentId) openPermissions(agentId, gatedFocus(operations()));
  };

  return (
    <PermissionRequestCard
      canApprove={approvals()?.canApprove(props.request) === true}
      request={permissionRequestParts(agent(), operations())}
      approver={approverName()}
      waitingDescription={waitingDescription()}
      canCancel={approvals()?.canCancel() === true}
      program={
        <Show when={hold()}>
          {(current) => <ProgramDisclosure hold={current()} />}
        </Show>
      }
      canEditPermissions={view()?.canEdit === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      onApproveOnce={() => answer('approve')}
      onAllowInSession={() => answer('approve_and_remember')}
      onDeny={() => answer('deny')}
      onEditPermissions={openSettings}
      onCancel={() => answer('cancel')}
    />
  );
}

/**
 * What the person allows, on request: the operations set to Ask it may
 * call, the program, and its module. Collapsed, it is one quiet link under
 * the sentence; open, it scrolls inside the dock so the input stays in view.
 */
function ProgramDisclosure(props: { hold: PermissionHold }) {
  const [open, setOpen] = createSignal(false);
  return (
    <div class="-mt-1 flex min-w-0 flex-col">
      <Button
        type="button"
        variant="ghost"
        size="xs"
        class="-ml-2 self-start"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        {open()
          ? t('agentPermissionsChat.hideProgram')
          : t('agentPermissionsChat.viewProgram')}
      </Button>
      <Show when={open()}>
        <div class="max-h-[40dvh] min-w-0 overflow-y-auto overscroll-contain">
          <Show when={props.hold.operations.length > 0}>
            <GatedOperationList operations={props.hold.operations} />
          </Show>
          <Show when={props.hold.source}>
            {(source) => (
              <Show
                when={props.hold.module}
                fallback={<ProgramText text={source()} />}
              >
                {(module) => (
                  <>
                    <ProgramPartLabel>
                      {t('agentPermissionsChat.programPart')}
                    </ProgramPartLabel>
                    <ProgramText text={source()} />
                    <ProgramPartLabel>
                      {t('agentPermissionsChat.modulePart')}
                    </ProgramPartLabel>
                    <ProgramText text={module()} />
                  </>
                )}
              </Show>
            )}
          </Show>
        </div>
      </Show>
    </div>
  );
}

/**
 * One part of a held program. Long lines wrap: the person approves all of
 * it, so none of it may sit past the card's edge.
 */
function ProgramText(props: { text: string }) {
  return (
    <pre class="mt-2 rounded-lg bg-ink/3 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
      {props.text}
    </pre>
  );
}

/** Names a part of a program that has two: what it runs, and its module. */
function ProgramPartLabel(props: { children: string }) {
  return (
    <p class="mt-2 text-xs font-medium text-ink-muted">{props.children}</p>
  );
}
