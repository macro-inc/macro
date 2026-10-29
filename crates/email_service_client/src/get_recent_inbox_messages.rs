use crate::EmailServiceClient;
use models_email::service::message::RecentInboxMessagesResponse;

impl EmailServiceClient {
    /// Up to `limit` of the newest messages across `user_id`'s own inboxes,
    /// read straight from Gmail and Outlook, so it works before the mailbox
    /// has synchronized.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_recent_inbox_messages(
        &self,
        user_id: &str,
        limit: u16,
    ) -> anyhow::Result<RecentInboxMessagesResponse> {
        let mut url = reqwest::Url::parse(&format!("{}/internal/recent_messages/", self.url))?;
        url.path_segments_mut()
            .map_err(|()| anyhow::anyhow!("email service url cannot have path segments"))?
            .pop_if_empty()
            .push(user_id);
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        let mut trace_headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace_headers);
        let response = self
            .client
            .get(url)
            .headers(trace_headers)
            .send()
            .await?
            .error_for_status()?;
        Ok(response.json().await?)
    }
}
