//! Internal HTTP adapter for calendar-owned invitation resolution.
use crate::domain::invitations::{
    CalendarInvitationService, InvitationIdentity, InvitationResolution, MAX_INVITATION_BATCH,
};
use rootcause::Report;

#[cfg(all(test, feature = "inbound"))]
mod test;

/// Resolve saved invitation identities through the deployed calendar service.
pub struct CalendarServiceInvitations {
    base_url: String,
    internal_api_key: String,
    http: reqwest::Client,
}

impl CalendarServiceInvitations {
    /// Use the existing calendar service URL and internal authorization key.
    pub fn new(base_url: String, internal_api_key: String) -> Self {
        Self {
            base_url: base_url.trim_end_matches('/').to_owned(),
            internal_api_key,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .expect("static reqwest client configuration is valid"),
        }
    }
}

impl CalendarInvitationService for CalendarServiceInvitations {
    async fn resolve(
        &self,
        viewer: &str,
        items: &[InvitationIdentity],
    ) -> Result<Vec<InvitationResolution>, Report> {
        if items.len() > MAX_INVITATION_BATCH {
            return Err(rootcause::report!("invitation batch exceeds service limit"));
        }
        if items.is_empty() {
            return Ok(Vec::new());
        }
        let results = self
            .http
            .post(format!("{}/internal/invitations/resolve", self.base_url))
            .header("x-internal-auth-key", &self.internal_api_key)
            .header("x-internal-macro-user-id", viewer)
            .json(items)
            .send()
            .await?
            .error_for_status()?
            .json::<Vec<InvitationResolution>>()
            .await?;
        if results.len() != items.len() {
            return Err(rootcause::report!(
                "incomplete invitation resolution response"
            ));
        }
        Ok(results)
    }
}
