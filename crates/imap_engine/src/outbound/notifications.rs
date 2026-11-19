//! Durable-journal wakeups to the owning email domain.
use crate::domain::{
    models::{Error, Notification},
    ports::Notifier,
};
use std::time::Duration;

/// Internal authenticated callback client, constructed with a typed service URL.
pub struct HttpNotifier {
    http: reqwest::Client,
    url: String,
    key: String,
}
impl HttpNotifier {
    /// Build one reusable client. The caller supplies EmailServiceUrl, never a user URL.
    pub fn new(base_url: String, key: String) -> Result<Self, Error> {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(5))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(Self {
            http,
            url: format!(
                "{}/internal/imap/notifications",
                base_url.trim_end_matches('/')
            ),
            key,
        })
    }
}
#[async_trait::async_trait]
impl Notifier for HttpNotifier {
    #[tracing::instrument(skip_all,fields(link_id=%notification.binding.link_id),err)]
    async fn notify(&self, notification: Notification) -> Result<(), Error> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        self.http
            .post(&self.url)
            .header("x-internal-auth-key", &self.key)
            .headers(headers)
            .json(&notification)
            .send()
            .await
            .map_err(|_| Error::ConnectionUnavailable)?
            .error_for_status()
            .map_err(|_| Error::ConnectionUnavailable)?;
        Ok(())
    }
}
