import {
  GatedOperationList,
  gatedFocus,
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
import { parsePermissionHold } from '../state/permission-approval';
import { ToolApprovalCard } from '../ui/ToolApprovalCard';

/**
 * A program held because operations it may call are set to Ask: what it
 * may do, by group and action, for the person it acts for to approve once,
 * allow for the session, or decline. Everyone else waits, and may cancel.
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
  const [showProgram, setShowProgram] = createSignal(false);

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
  const canApprove = () => approvals()?.canApprove(props.request) === true;
  const view = () =>
    permissionsQuery.isSuccess
      ? (permissionsQuery.data ?? undefined)
      : undefined;

  const answer = (value: ToolApprovalAnswerDto) =>
    fireAndForget(
      approvals()?.answer(props.request.approvalId, value),
      'agent-interactions'
    );
  const openSettings = () => {
    const agentId = view()?.agentId;
    if (agentId) openPermissions(agentId, gatedFocus(operations()));
  };

  const note = () => {
    if (!canApprove()) {
      return approvals()?.canCancel()
        ? t('agentPermissionsChat.waitingNote', { name: approverName() })
        : t('agentPermissionsChat.waitingNoteOnly', { name: approverName() });
    }
    const message = t('agentPermissionsChat.approverNote', { agent: agent() });
    const [before, link, after] = message.split(/<link>|<\/link>/);
    return (
      <>
        {before}
        <Show when={view()?.canEdit} fallback={link}>
          <button
            type="button"
            class="text-ink underline decoration-edge underline-offset-2 outline-none not-touch:hover:decoration-ink focus-visible:decoration-ink"
            onClick={openSettings}
          >
            {link}
          </button>
        </Show>
        {after}
      </>
    );
  };

  return (
    <ToolApprovalCard
      ariaLabel={t('agentPermissionsChat.approvalLabel')}
      action=""
      owner={approverName()}
      canApprove={canApprove()}
      canCancel={approvals()?.canCancel() === true}
      disabled={approvals()?.answering(props.request.approvalId)}
      // Always offered: this remembers the asked operations for the session.
      standing="allow"
      standingNote={null}
      title={
        canApprove()
          ? t('agentPermissionsChat.approvalNeeded')
          : t('agentPermissionsChat.waitingFor', { name: approverName() })
      }
      description={
        canApprove()
          ? t('agentPermissionsChat.wantsToRun', { agent: agent() })
          : t('agentPermissionsChat.wantsToRunAs', {
              agent: agent(),
              name: approverName(),
            })
      }
      details={
        <>
          <Show when={operations().length > 0}>
            <GatedOperationList operations={operations()} />
          </Show>
          <p class="mt-2 text-xs leading-4 text-ink-muted [overflow-wrap:anywhere]">
            {note()}
          </p>
          <Show when={hold()?.source}>
            {(source) => (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  class="mt-1.5 -ml-2 self-start"
                  aria-expanded={showProgram()}
                  onClick={() => setShowProgram((open) => !open)}
                >
                  {showProgram()
                    ? t('agentPermissionsChat.hideProgram')
                    : t('agentPermissionsChat.viewProgram')}
                </Button>
                <Show when={showProgram()}>
                  <Show
                    when={hold()?.module}
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
                </Show>
              </>
            )}
          </Show>
        </>
      }
      labels={{
        decline: t('agentPermissionsChat.decline'),
        approveAlways: t('agentPermissionsChat.allowForSession'),
        approve: t('agentPermissionsChat.approve'),
        cancel: t('agentPermissionsChat.cancel'),
      }}
      onApprove={() => answer('approve')}
      onApproveAlways={() => answer('approve_and_remember')}
      onDeny={() => answer('deny')}
      onCancel={() => answer('cancel')}
    />
  );
}

/**
 * One part of a held program. Long lines wrap: the person approves all of
 * it, so none of it may sit past the card's edge.
 */
function ProgramText(props: { text: string }) {
  return (
    <pre class="mt-1 max-h-60 overflow-y-auto rounded-lg bg-ink/3 p-3 font-mono text-xs leading-5 whitespace-pre-wrap text-ink-muted [overflow-wrap:anywhere]">
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
