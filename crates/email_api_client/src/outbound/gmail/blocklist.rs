//! Gmail blocked-sender capability implementation.

use models_email::gmail::filters::{Filter, FilterAction, FilterCriteria};

use crate::domain::models::{AccessToken, EmailApiError};
use crate::domain::ports::MailboxBlocklistClient;

use super::{GmailApiClientRepository, map_gmail_error};

const TRASH_LABEL_ID: &str = "TRASH";

impl MailboxBlocklistClient for GmailApiClientRepository {
    async fn block_sender(
        &self,
        access_token: &AccessToken,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        let token = access_token.expose_secret();
        let filters = self
            .client
            .list_filters(token)
            .await
            .map_err(map_gmail_error)?;
        if find_block_filter(&filters, email_address).is_some() {
            return Ok(());
        }

        self.client
            .create_filter(token, block_filter(email_address))
            .await
            .map_err(map_gmail_error)?;
        Ok(())
    }

    async fn unblock_sender(
        &self,
        access_token: &AccessToken,
        email_address: &str,
    ) -> Result<(), EmailApiError> {
        let token = access_token.expose_secret();
        let filters = self
            .client
            .list_filters(token)
            .await
            .map_err(map_gmail_error)?;
        let Some(filter) = find_block_filter(&filters, email_address) else {
            return Ok(());
        };
        let Some(filter_id) = filter.id.as_deref() else {
            return Err(EmailApiError::Permanent {
                message: "Gmail blocked-sender filter is missing its provider ID".to_string(),
            });
        };

        self.client
            .delete_filter(token, filter_id)
            .await
            .map_err(map_gmail_error)
    }

    async fn list_blocked_senders(
        &self,
        access_token: &AccessToken,
    ) -> Result<Vec<String>, EmailApiError> {
        let filters = self
            .client
            .list_filters(access_token.expose_secret())
            .await
            .map_err(map_gmail_error)?;

        Ok(filters
            .iter()
            .filter(|filter| is_block_filter(filter))
            .filter_map(|filter| filter.criteria.from.clone())
            .collect())
    }
}

fn block_filter(email_address: &str) -> Filter {
    Filter {
        id: None,
        criteria: FilterCriteria {
            from: Some(email_address.to_string()),
            to: None,
            subject: None,
            query: None,
            negated_query: None,
            has_attachment: None,
            exclude_chats: None,
        },
        action: FilterAction {
            add_label_ids: Some(vec![TRASH_LABEL_ID.to_string()]),
            remove_label_ids: None,
            forward: None,
        },
    }
}

fn find_block_filter<'a>(filters: &'a [Filter], email_address: &str) -> Option<&'a Filter> {
    filters.iter().find(|filter| {
        is_block_filter(filter) && filter.criteria.from.as_deref() == Some(email_address)
    })
}

fn is_block_filter(filter: &Filter) -> bool {
    filter.criteria.from.is_some()
        && filter
            .action
            .add_label_ids
            .as_ref()
            .is_some_and(|label_ids| label_ids.iter().any(|label_id| label_id == TRASH_LABEL_ID))
}
