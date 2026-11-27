#[cfg(test)]
mod test;

use crate::domain::models::invalidation::ContactsInvalidation;
use crate::domain::ports::ContactsNotifier;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;

/// The `contacts_invalidation` body. `changed` is omitted when the change is
/// unknown, which is also the whole body older clients ignore.
#[derive(Serialize)]
struct InvalidationBody<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    changed: Option<&'a [MacroUserIdStr<'static>]>,
}

/// Notifier that sends invalidation messages through the connection gateway.
pub struct ConnectionGatewayNotifier {
    url: String,
    client: reqwest::Client,
}

impl ConnectionGatewayNotifier {
    /// Creates a new notifier with the given gateway URL and internal auth key.
    pub fn new(internal_auth_key: String, url: String) -> Result<Self, Report> {
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert("x-internal-auth-key", internal_auth_key.parse()?);
        let client = reqwest::Client::builder()
            .default_headers(headers)
            .build()?;
        Ok(Self { url, client })
    }

    /// Errors drop their URL, which names the user.
    #[tracing::instrument(
        name = "contacts.invalidate",
        skip_all,
        fields(changed = invalidation.changed().map(|changed| changed.len() as i64)),
        err
    )]
    async fn invalidate_contacts(&self, invalidation: &ContactsInvalidation) -> Result<(), Report> {
        let body = InvalidationBody {
            changed: invalidation.changed(),
        };
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(format!(
                "{}/message/send/user/{}",
                self.url,
                urlencoding::encode(invalidation.user().as_ref())
            ))
            .headers(headers)
            .json(&serde_json::json!({"message_type": "contacts_invalidation", "message": body}))
            .send()
            .await
            .map_err(reqwest::Error::without_url)?;
        let status = response
            .error_for_status_ref()
            .map(drop)
            .map_err(reqwest::Error::without_url);
        // Read the body even on error statuses: h2 only refunds its small-DATA-frame
        // budget for frames that are read, and once that budget is spent the client
        // tears down its own pooled connection (GOAWAY `too_many_data_frames`).
        response
            .bytes()
            .await
            .map_err(reqwest::Error::without_url)?;
        status?;
        Ok(())
    }
}

impl ContactsNotifier for ConnectionGatewayNotifier {
    async fn invalidate_contacts_for_users(
        &self,
        invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), Report> {
        for invalidation in invalidations {
            self.invalidate_contacts(&invalidation)
                .await
                .inspect_err(|e| tracing::error!(error = ?e, "Failed to invalidate contacts"))
                .ok();
        }
        Ok(())
    }
}

/// Implements [`ContactsNotifier`] for `Option<ConnectionGatewayNotifier>`,
/// acting as a no-op when `None`.
impl ContactsNotifier for Option<ConnectionGatewayNotifier> {
    async fn invalidate_contacts_for_users(
        &self,
        invalidations: Vec<ContactsInvalidation>,
    ) -> Result<(), Report> {
        if let Some(notifier) = self {
            notifier
                .invalidate_contacts_for_users(invalidations)
                .await?;
        }
        Ok(())
    }
}
