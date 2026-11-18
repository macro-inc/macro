//! OpenSearch adapter for the email attachment flag port.

use std::sync::Arc;

use opensearch_client::{OpensearchClient, error::OpensearchClientError};

use crate::domain::email_attachment_status::{
    EmailAttachmentFlagIndex, FlagIndexError, FlagUpdate,
};

pub struct OpenSearchEmailAttachmentFlags(pub Arc<OpensearchClient>);

impl EmailAttachmentFlagIndex for OpenSearchEmailAttachmentFlags {
    async fn set_email_attachment(
        &self,
        document_ids: &[String],
        is_email_attachment: bool,
    ) -> Result<FlagUpdate, FlagIndexError> {
        let result = self
            .0
            .bulk_update_email_attachment(document_ids, is_email_attachment)
            .await
            .map_err(|error| match error {
                OpensearchClientError::WritesRefused { .. } => {
                    FlagIndexError::Refused(error.to_string())
                }
                error => FlagIndexError::Internal(rootcause::Report::new(error).into_dynamic()),
            })?;

        if !result.failed.is_empty() {
            let failed: Vec<_> = result
                .failed
                .iter()
                .map(|item| {
                    (
                        item.document_id.as_str(),
                        item.status,
                        item.error_type.as_str(),
                    )
                })
                .collect();
            tracing::warn!(
                ?failed,
                "search index failed to set the email attachment flag"
            );
        }

        Ok(FlagUpdate {
            updated: result.updated,
            missing: result.missing,
            failed: result.failed.len(),
        })
    }
}
