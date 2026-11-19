//! The permission gate in front of an OCaml program: read which SDK
//! operations it may call, check them against the agent's permissions, then
//! refuse it, hold it for the person it acts as, or let it run limited to
//! those operations.
//!
//! It applies only to OCaml programs of sessions whose owner has the
//! permissions rollout; everything else runs exactly as before.

use std::collections::BTreeSet;
use std::sync::Arc;

use agent_code_mode::domain::{
    CodeModeError, DeclinedStatus, ExecutionIdentity, ExecutionPermission, GatedOperation, NotRun,
    OcamlRollout, ProgramLanguage,
};
use agent_egress::domain::approval::{PermissionApprovals, PermissionHold, refusal};
use agent_egress::domain::model::TurnPrompter;
use agent_permissions::domain::admission::admit;
use agent_permissions::domain::model::{Admission, OperationKey, SessionPolicy};
use agent_permissions::domain::service::AgentPermissions;
use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use async_trait::async_trait;
use code_execution::domain::{Analysis, AnalysisReason, CheckError, ProgramAnalyzer, SdkCall};
use macro_user_id::user_id::MacroUserIdStr;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
pub(crate) mod test;

/// Who prompted a session's running turn.
// Object-safe: the gate holds it as `Arc<dyn TurnPrompters>`.
#[async_trait]
pub trait TurnPrompters: Send + Sync + 'static {
    /// The prompter of the turn `session` is running; `None` without one.
    async fn current(
        &self,
        session: agent_session::domain::model::AgentSessionId,
    ) -> Result<Option<TurnPrompter>, rootcause::Report>;
}

#[async_trait]
impl<Sessions> TurnPrompters for Sessions
where
    Sessions: agent_session::domain::ports::AgentSessionRepo + Send + Sync + 'static,
{
    async fn current(
        &self,
        session: agent_session::domain::model::AgentSessionId,
    ) -> Result<Option<TurnPrompter>, rootcause::Report> {
        self.turn_prompter(session)
            .await
            .map_err(|error| rootcause::report!("{error:?}").into_dynamic())
    }
}

/// The gate's parts. Wired only where the runner has the OCaml bundle.
pub struct PermissionGate {
    /// Lists the operations a program may call.
    pub analyzer: Arc<dyn ProgramAnalyzer>,
    /// The agent's permissions.
    pub permissions: Arc<dyn AgentPermissions>,
    /// Holds a program for the person it acts as.
    pub holds: Arc<dyn PermissionApprovals>,
    /// The permissions rollout, per session owner.
    pub rollout: Arc<dyn OcamlRollout>,
    /// The running turn's prompter.
    pub prompters: Arc<dyn TurnPrompters>,
}

/// A program the gate checked and did not refuse.
#[derive(Debug, Clone)]
pub struct Checked {
    /// Every request it may send: what the bootstrap lets through.
    pub calls: BTreeSet<SdkCall>,
    /// The operations set to ask.
    pub ask: Vec<GatedOperation>,
}

impl PermissionGate {
    /// Before anyone is asked anything: `None` when the gate does not apply
    /// (JavaScript, or the owner lacks the rollout), else the program's
    /// calls, or `NotRun` when it cannot be analyzed, does not compile, or
    /// may call an operation set to never.
    pub async fn check(
        &self,
        identity: &ExecutionIdentity,
        source: &str,
        language: ProgramLanguage,
    ) -> Result<Option<Checked>, CodeModeError> {
        if language != ProgramLanguage::Ocaml || !self.rollout.enabled(&identity.owner).await {
            return Ok(None);
        }
        let calls = match self.analyzer.may_call(source).await {
            Ok(Analysis::Calls(calls)) => calls,
            Ok(Analysis::CannotAnalyze(reasons)) => {
                return Err(not_run(cannot_analyze(&reasons), None));
            }
            Ok(Analysis::Diagnostics(diagnostics)) => {
                let message = diagnostics
                    .into_iter()
                    .map(|diagnostic| diagnostic.message)
                    .collect::<Vec<_>>()
                    .join("\n\n");
                return Err(not_run(message, None));
            }
            Err(CheckError::Busy) => return Err(CodeModeError::Busy),
            Err(CheckError::InvalidSource) => {
                return Err(CodeModeError::Invalid(
                    "Provide a nonempty OCaml program of at most 64 KiB.".into(),
                ));
            }
            Err(CheckError::Internal) => return Err(CodeModeError::Unavailable),
        };
        let keys: Vec<OperationKey> = calls
            .iter()
            .map(|call| OperationKey {
                service: call.operation.service.clone(),
                operation: call.operation.operation_id.clone(),
            })
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let Admission { blocked, ask, .. } = admit(
            self.permissions.as_ref(),
            &SessionPolicy {
                agent: identity.agent_id,
                owner: identity.owner.clone(),
                session: identity.session,
            },
            &keys,
        )
        .await
        .map_err(|error| {
            tracing::error!(?error, "could not resolve the agent's permissions");
            CodeModeError::Unavailable
        })?;
        if !blocked.is_empty() {
            return Err(not_run(
                blocked_text(&blocked),
                Some(ExecutionPermission::Blocked {
                    operations: blocked,
                }),
            ));
        }
        Ok(Some(Checked { calls, ask }))
    }

    /// Once the run's account is known (`actor`): hold the program for it
    /// when it may call operations set to ask, unless it already allowed them
    /// for the session. `NotRun` unless approved.
    pub async fn hold(
        &self,
        checked: &Checked,
        identity: &ExecutionIdentity,
        actor: &MacroUserIdStr<'static>,
        source: &str,
        cancel: &CancellationToken,
    ) -> Result<(), CodeModeError> {
        if checked.ask.is_empty() {
            return Ok(());
        }
        let session = identity.session;
        let Some(prompter) = self.prompter(session).await? else {
            return Err(not_run(
                format!(
                    "This OCaml program did not run: it needs a person's approval for: {}, \
                     and no turn is running to ask in.",
                    labels(&checked.ask)
                ),
                Some(declined(DeclinedStatus::Expired, &checked.ask)),
            ));
        };
        let hold = PermissionHold {
            session,
            approver: actor.clone(),
            prompter: prompter.clone(),
            operations: checked
                .ask
                .iter()
                .map(|operation| format!("{}.{}", operation.service, operation.operation))
                .collect(),
            arguments: serde_json::json!({
                "source": source,
                "permission": {
                    "executionId": identity.execution,
                    "language": ProgramLanguage::Ocaml,
                    "operations": checked.ask,
                },
            }),
        };
        // A stopped turn drops the hold, which cancels it.
        let status = tokio::select! {
            biased;
            () = cancel.cancelled() => return Err(not_run(
                "The program was stopped while it waited for approval; it did not run.".into(),
                Some(declined(DeclinedStatus::Cancelled, &checked.ask)),
            )),
            status = self.holds.hold_permissions(hold) => status,
        }
        .map_err(|error| {
            tracing::error!(?error, "could not hold a program for approval");
            CodeModeError::Unavailable
        })?;
        if self.prompter(session).await?.as_ref() != Some(&prompter) {
            return Err(not_run(
                "The original turn ended; the program did not run.".into(),
                Some(declined(DeclinedStatus::Cancelled, &checked.ask)),
            ));
        }
        let status = match status {
            ToolApprovalStatus::Approved => return Ok(()),
            ToolApprovalStatus::Denied => DeclinedStatus::Denied,
            ToolApprovalStatus::Cancelled => DeclinedStatus::Cancelled,
            ToolApprovalStatus::Expired | ToolApprovalStatus::Pending => DeclinedStatus::Expired,
        };
        let refused = refusal(
            match status {
                DeclinedStatus::Denied => ToolApprovalStatus::Denied,
                DeclinedStatus::Cancelled => ToolApprovalStatus::Cancelled,
                DeclinedStatus::Expired => ToolApprovalStatus::Expired,
            },
            actor.email_str(),
            "this program",
        )
        .unwrap_or_default();
        Err(not_run(
            format!(
                "{refused} It needed approval for: {}.",
                labels(&checked.ask)
            ),
            Some(declined(status, &checked.ask)),
        ))
    }

    async fn prompter(
        &self,
        session: agent_session::domain::model::AgentSessionId,
    ) -> Result<Option<TurnPrompter>, CodeModeError> {
        self.prompters.current(session).await.map_err(|error| {
            tracing::error!(?error, "could not read the turn's prompter");
            CodeModeError::Unavailable
        })
    }
}

fn not_run(message: String, permission: Option<ExecutionPermission>) -> CodeModeError {
    CodeModeError::NotRun(NotRun {
        message,
        permission,
    })
}

fn declined(status: DeclinedStatus, operations: &[GatedOperation]) -> ExecutionPermission {
    ExecutionPermission::Declined {
        status,
        operations: operations.to_vec(),
    }
}

fn labels(operations: &[GatedOperation]) -> String {
    operations
        .iter()
        .map(|operation| operation.label.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// What the model is told about a program it must rewrite.
pub(crate) fn cannot_analyze(reasons: &[AnalysisReason]) -> String {
    let reasons = reasons
        .iter()
        .map(|reason| {
            format!(
                "main.ml:{}:{}: {}",
                reason.line, reason.column, reason.message
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    format!(
        "This OCaml program did not run. Before running a program, code mode reads which Macro \
         SDK operations it calls, and this one can reach operations that cannot be read:\n\
         {reasons}\nRewrite it to call SDK operations directly (no Obj, external, Marshal or \
         hand-built requests) and run it again."
    )
}

/// What the model is told about a program that may call operations set to
/// never.
pub(crate) fn blocked_text(blocked: &[GatedOperation]) -> String {
    let operations = blocked
        .iter()
        .map(|operation| {
            let action = operation
                .action
                .map(|action| format!("{}, ", action.as_str()))
                .unwrap_or_default();
            format!(
                "{} ({}, {action}{}.{})",
                operation.label, operation.group_name, operation.service, operation.operation
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "This OCaml program did not run: this agent is not allowed to {operations}. Nothing was \
         sent. Do not try to do this another way. If the person wants to allow it, call \
         ShowPermissions with these operations so they can change the setting."
    )
}
