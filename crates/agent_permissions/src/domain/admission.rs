//! A run's gate: what the agent's permissions say about every SDK operation
//! a program may call, sorted into blocked, ask and allowed.

#[cfg(test)]
mod test;

use super::model::{
    Admission, GatedOperation, OperationKey, PermissionError, PermissionState, ResolvedCall,
    SessionPolicy,
};
use super::service::AgentPermissions;

/// The group of an operation the registry does not know.
const UNCLASSIFIED: &str = "unclassified";

/// What `policy`'s permissions say about `calls`: any `never` blocks the
/// program, any `ask` holds it. An operation the registry does not know is
/// blocked (fail closed).
#[tracing::instrument(
    name = "agent_permissions.admit",
    skip_all,
    fields(
        agent_id = %policy.agent,
        policy = if bot_id::system_bot(policy.agent).is_some_and(|bot| bot.has_agent) { "persona" } else { "agent" },
        agent_session_id = %policy.session.as_uuid(),
        operations = calls.len(),
        blocked = tracing::field::Empty,
        ask = tracing::field::Empty,
        outcome = tracing::field::Empty,
    ),
    err
)]
pub async fn admit(
    permissions: &dyn AgentPermissions,
    policy: &SessionPolicy,
    calls: &[OperationKey],
) -> Result<Admission, PermissionError> {
    let admission = sort(permissions.resolve_calls(policy, calls).await?);
    let span = tracing::Span::current();
    span.record("blocked", admission.blocked.len());
    span.record("ask", admission.ask.len());
    span.record(
        "outcome",
        if !admission.blocked.is_empty() {
            "blocked"
        } else if !admission.ask.is_empty() {
            "ask"
        } else {
            "run"
        },
    );
    Ok(admission)
}

/// Sort resolved calls by state, each as the dialog and refusals name it.
pub fn sort(resolved: Vec<ResolvedCall>) -> Admission {
    let mut admission = Admission::default();
    for call in resolved {
        let state = call.state;
        let operation = gated(call);
        match state {
            PermissionState::Never => admission.blocked.push(operation),
            PermissionState::Ask => admission.ask.push(operation),
            PermissionState::Always => admission.allowed.push(operation),
        }
    }
    admission
}

fn gated(call: ResolvedCall) -> GatedOperation {
    let ResolvedCall {
        key,
        entry,
        state,
        origin,
    } = call;
    match entry {
        Some(entry) => {
            let group_name = agent_permission_registry::group(&entry.group)
                .map_or_else(|| entry.group.clone(), |group| group.name.clone());
            GatedOperation {
                service: key.service,
                operation: key.operation,
                label: entry.label,
                group: entry.group,
                group_name,
                action: Some(entry.action),
                state,
                origin,
            }
        }
        None => GatedOperation {
            label: format!("{}.{}", key.service, key.operation),
            service: key.service,
            operation: key.operation,
            group: UNCLASSIFIED.to_owned(),
            group_name: "Unclassified".to_owned(),
            action: None,
            state,
            origin,
        },
    }
}
