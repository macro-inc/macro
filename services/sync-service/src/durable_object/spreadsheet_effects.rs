//! Worker notification adapter for the spreadsheet update use case.

use bebop::{Record, SubRecord};
use tracing::{error, warn};

use super::{
    DocumentSyncSession, EditAttribution, bump_alarm, report_interaction, report_new_doc_state,
};
use crate::{
    dss_internal::InteractionReason,
    spreadsheet::{SpreadsheetAttribution, SpreadsheetError, SpreadsheetUpdateEffects},
    state::DocumentState,
};

pub(super) struct WorkerSpreadsheetEffects<'a> {
    pub session: &'a DocumentSyncSession,
    pub document_state: &'a DocumentState,
    pub document_id: &'a str,
    pub attribution: Option<&'a SpreadsheetAttribution>,
}

fn notification_error(error: impl std::fmt::Debug) -> SpreadsheetError {
    error!(error = ?error, "failed to notify spreadsheet update");
    SpreadsheetError::Notification
}

impl SpreadsheetUpdateEffects for WorkerSpreadsheetEffects<'_> {
    fn broadcast(&self, update: &[u8]) -> Result<(), SpreadsheetError> {
        let message = crate::generated::schema::FromRemote::RemoteUpdate {
            update: bebop::SliceWrapper::Raw(update),
        };
        let mut message_bytes = Vec::with_capacity(message.serialized_size());
        message
            .serialize(&mut message_bytes)
            .map_err(notification_error)?;
        for socket in self.session.get_websockets() {
            if let Err(error) = socket.send_with_bytes(&message_bytes) {
                warn!(error = ?error, "failed to broadcast spreadsheet update; continuing");
            }
        }
        Ok(())
    }

    fn publish_changed_document(&self) -> Result<(), SpreadsheetError> {
        let attribution = self.attribution.as_ref().map(|claims| EditAttribution {
            actor: claims.actor.clone(),
            on_behalf_of: claims.on_behalf_of.clone(),
        });
        let snapshot = self
            .document_state
            .export_shallow_snapshot()
            .map_err(notification_error)?;
        let env = self.session.env.clone();
        let document_id = self.document_id.to_owned();
        self.session.state.wait_until(async move {
            report_new_doc_state(&document_id, &snapshot, false, &env, attribution).await;
            report_interaction(&document_id, &env, InteractionReason::Edited).await;
        });
        Ok(())
    }

    async fn keep_alive(&self) -> Result<(), SpreadsheetError> {
        bump_alarm(&self.session.state)
            .await
            .map_err(notification_error)
    }
}
