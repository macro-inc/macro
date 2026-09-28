//! Lifecycle events trigger an authoritative reread, including deletion.

use ::agent_session::domain::events::AgentSessionLifecycleMacroEvent;
use macro_event_broker::MacroEvent as _;

use super::{EventOutcome, KafkaProcessingContext, retry_processing};

pub(super) async fn process_agent_session_event(
    context: &KafkaProcessingContext,
    event: &AgentSessionLifecycleMacroEvent,
) -> EventOutcome {
    let id = event.event().event.session_id();
    match retry_processing(|attempt| async move {
        context.agent_session_indexer.reconcile(id, None).await.inspect_err(|error| {
            tracing::error!(error=?error, session_id=%id, attempt, "agent session indexing failed");
        })
    })
    .await
    {
        Ok(()) => EventOutcome::Indexed,
        Err(error) => {
            tracing::error!(error=?error, session_id=%id, "agent session indexing exhausted retries; repair with backfill");
            EventOutcome::Dropped
        }
    }
}
