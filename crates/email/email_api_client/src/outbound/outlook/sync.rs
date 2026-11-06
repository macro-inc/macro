use chrono::{DateTime, Utc};
use reqwest::Method;
use serde_json::json;

use super::{OutlookApiClientRepository, transport::invalid_response, wire};
use crate::domain::models::{
    AccessToken, EmailApiError, MailboxChangePage, MailboxSubscription, ProviderId, StreamPosition,
    StreamToken,
};
use crate::domain::ports::{FolderChangeReader, MailboxWatchClient};

impl FolderChangeReader for OutlookApiClientRepository {
    async fn folder_changes(
        &self,
        token: &AccessToken,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, EmailApiError> {
        let url = match position {
            Some(position) => self.continuation(position)?,
            None => {
                let mut url =
                    self.endpoint(&["me", "mailFolders", folder.as_str(), "messages", "delta"])?;
                url.query_pairs_mut()
                    .append_pair("$select", "id")
                    .append_pair("$top", "100");
                url
            }
        };
        let page: wire::Page<wire::Change> = self.get(token, url).await?;
        let mut changed = Vec::new();
        let mut removed = Vec::new();
        for message in page.value {
            let id = ProviderId::new(message.id)?;
            if message.removed.is_some() {
                removed.push(id);
            } else {
                changed.push(id);
            }
        }
        let position = match (page.next, page.delta) {
            (Some(next), None) => StreamPosition::Continue(StreamToken::new(next)),
            (None, Some(delta)) => StreamPosition::Checkpoint(StreamToken::new(delta)),
            _ => return Err(invalid_response()),
        };
        // Reject unsafe URLs before they can become durable checkpoints.
        let next = match &position {
            StreamPosition::Continue(t) | StreamPosition::Checkpoint(t) => t,
        };
        self.continuation(next)?;
        Ok(MailboxChangePage {
            changed,
            removed,
            position,
        })
    }
}

impl MailboxWatchClient for OutlookApiClientRepository {
    async fn watches(
        &self,
        token: &AccessToken,
    ) -> Result<Vec<crate::domain::models::MailboxWatchDetails>, EmailApiError> {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Watch {
            id: String,
            expiration_date_time: DateTime<Utc>,
            notification_url: String,
            lifecycle_notification_url: Option<String>,
            resource: String,
        }
        let mut result = Vec::new();
        let mut visited = std::collections::HashSet::new();
        let mut url = self.endpoint(&["subscriptions"])?;
        loop {
            if !visited.insert(url.as_str().to_owned()) {
                return Err(invalid_response());
            }
            let page: wire::Page<Watch> = self.get(token, url).await?;
            for value in page.value {
                result.push(crate::domain::models::MailboxWatchDetails {
                    subscription: MailboxSubscription {
                        id: ProviderId::new(value.id)?,
                        expires_at: value.expiration_date_time,
                    },
                    notification_url: value.notification_url,
                    lifecycle_url: value.lifecycle_notification_url,
                    resource: value.resource,
                });
            }
            match page.next {
                Some(next) => url = self.continuation(&StreamToken::new(next))?,
                None => return Ok(result),
            }
        }
    }
    async fn create_watch(
        &self,
        token: &AccessToken,
        notification_url: &str,
        lifecycle_url: &str,
        client_state: &str,
        expires_at: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        let body = json!({
            "changeType":"created,updated,deleted", "resource":"me/messages",
            "notificationUrl":notification_url, "lifecycleNotificationUrl":lifecycle_url,
            "clientState":client_state, "expirationDateTime":expires_at.to_rfc3339(),
        });
        let result: wire::Subscription = self
            .request(
                token,
                Method::POST,
                self.endpoint(&["subscriptions"])?,
                Some(&body),
            )
            .await?
            .json()
            .await
            .map_err(|_| invalid_response())?;
        subscription(result)
    }

    async fn renew_watch(
        &self,
        token: &AccessToken,
        id: &ProviderId,
        expires_at: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        let body = json!({"expirationDateTime":expires_at.to_rfc3339()});
        let result: wire::Subscription = self
            .request(
                token,
                Method::PATCH,
                self.endpoint(&["subscriptions", id.as_str()])?,
                Some(&body),
            )
            .await?
            .json()
            .await
            .map_err(|_| invalid_response())?;
        subscription(result)
    }

    async fn remove_watch(
        &self,
        token: &AccessToken,
        id: &ProviderId,
    ) -> Result<(), EmailApiError> {
        match self
            .request(
                token,
                Method::DELETE,
                self.endpoint(&["subscriptions", id.as_str()])?,
                None,
            )
            .await
        {
            Ok(_) | Err(EmailApiError::NotFound) => Ok(()),
            Err(error) => Err(error),
        }
    }
}

fn subscription(value: wire::Subscription) -> Result<MailboxSubscription, EmailApiError> {
    Ok(MailboxSubscription {
        id: ProviderId::new(value.id)?,
        expires_at: value.expiration_date_time,
    })
}
