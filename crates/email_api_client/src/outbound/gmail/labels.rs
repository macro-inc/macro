//! Gmail label capability implementation.

use models_email::gmail::labels::{GmailLabel, GmailLabelsResponse};
use models_email::service::label::Label;
use uuid::Uuid;

use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::MailboxLabelClient;

use super::convert::{map_label_to_service, map_labels_to_service};
use super::{GmailApiClientRepository, map_gmail_error};

impl MailboxLabelClient for GmailApiClientRepository {
    async fn list_labels(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
    ) -> Result<Vec<Label>, EmailApiError> {
        let labels = self
            .client
            .fetch_user_labels(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)?;
        map_labels_to_service(&GmailLabelsResponse { labels }, link_id)
    }

    async fn create_label(
        &self,
        access_token: &AccessToken,
        link_id: Uuid,
        name: &str,
    ) -> Result<Label, EmailApiError> {
        let request = GmailLabel {
            id: None,
            name: name.to_owned(),
            message_list_visibility: Some("show".to_string()),
            label_list_visibility: Some("labelShow".to_string()),
            type_: Some("user".to_string()),
            color: None,
        };
        let label = self
            .client
            .create_label(access_token.expose_secret(), &request)
            .await
            .map_err(map_gmail_error)?;
        map_label_to_service(&label, link_id)
    }

    async fn delete_label(
        &self,
        access_token: &AccessToken,
        provider_label_id: &str,
    ) -> Result<(), EmailApiError> {
        match self
            .client
            .delete_label(access_token.expose_secret(), provider_label_id)
            .await
        {
            Ok(()) => Ok(()),
            Err(error) if error.status().is_some_and(|status| status.as_u16() == 404) => Ok(()),
            Err(error) => Err(map_gmail_error(error)),
        }
    }
}
