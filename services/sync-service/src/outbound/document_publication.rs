//! Existing document notification transports shared by room and legacy adapters.
use crate::{
    domain::document::DocumentAttribution,
    dss_internal::{DssInternal, DssInternalClient, InteractionReason},
};
use tracing::warn;
use worker::Env;

pub(crate) async fn report_new_doc_state(
    session_key: &str,
    snapshot: &[u8],
    env: &Env,
    editors: Vec<DocumentAttribution>,
) {
    if let Err(error) = DssInternalClient::new(env)
        .publish_shallow_snapshot(session_key, snapshot)
        .await
    {
        warn!(error = ?error, "failed to push snapshot to DSS");
    }
    #[cfg(feature = "search-service")]
    if let Err(error) = DssInternalClient::new(env)
        .publish_sync_content_updated(session_key, editors)
        .await
    {
        warn!(error = ?error, "failed to publish document content change");
    }
}

pub(crate) async fn report_interaction(session_key: &str, env: &Env, reason: InteractionReason) {
    if let Err(error) = DssInternalClient::new(env)
        .publish_interaction(session_key, reason)
        .await
    {
        warn!(error = ?error, "failed to push interaction to DSS");
    }
}
