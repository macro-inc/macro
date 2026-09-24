//! Admission and execution of independently initiated AI tool operations.

use ai_billing::domain::AiAdmissionService;
use ai_usage::{UsageContext, UsageRecorder};
use macro_user_id::user_id::MacroUserIdStr;
use std::future::Future;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

pub(crate) async fn complete_subagent(
    admission: &dyn AiAdmissionService,
    recorder: &dyn UsageRecorder,
    parent_usage: &UsageContext,
    user: MacroUserIdStr<'static>,
    task: &str,
    cancel: &CancellationToken,
) -> anyhow::Result<String> {
    run_subagent_with(admission, user, parent_usage, cancel, |usage| {
        agent::complete(
            agent::PredefinedModel::Smart,
            include_str!("prompts/subagent.md"),
            task,
            recorder,
            usage,
        )
    })
    .await
}

async fn run_subagent_with<F, Fut>(
    admission: &dyn AiAdmissionService,
    user: MacroUserIdStr<'static>,
    parent_usage: &UsageContext,
    cancel: &CancellationToken,
    complete: F,
) -> anyhow::Result<String>
where
    F: FnOnce(UsageContext) -> Fut,
    Fut: Future<Output = anyhow::Result<String>>,
{
    // Subagent cost rolls up to its parent feature/entity, but identity always
    // comes from the authenticated request, never a host's system default.
    let usage = UsageContext::new(parent_usage.feature, user).with_entity(parent_usage.entity);
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Ok("cancelled".to_owned()),
        result = async {
            admission.admit(&usage.user, usage.feature).await?;
            complete(usage).await
        } => result,
    }
}
