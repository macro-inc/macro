use crate::EmailServiceClient;
use email_types::email::service::message::RecentInboxMessagesResponse;

#[cfg(test)]
mod test;

impl EmailServiceClient {
    /// Up to `limit` (1 to 100) of the newest messages across `user_id`'s
    /// own inboxes, newest first, read straight from Gmail and Outlook so it
    /// works before the mailbox has synchronized, with the provider's
    /// 300-character snippets.
    pub async fn get_recent_inbox_messages(
        &self,
        user_id: &str,
        limit: u16,
    ) -> anyhow::Result<RecentInboxMessagesResponse> {
        self.get_recent_inbox_messages_with_snippets(user_id, limit, None)
            .await
    }

    /// `get_recent_inbox_messages` with snippets of up to `snippet_chars`
    /// (at most 500), filled from the body where the provider's is shorter.
    #[tracing::instrument(skip_all, fields(limit, snippet_chars), err)]
    pub async fn get_recent_inbox_messages_with_snippets(
        &self,
        user_id: &str,
        limit: u16,
        snippet_chars: Option<u16>,
    ) -> anyhow::Result<RecentInboxMessagesResponse> {
        let mut url = reqwest::Url::parse(&format!("{}/internal/recent_messages/", self.url))?;
        url.path_segments_mut()
            .map_err(|()| anyhow::anyhow!("email service url cannot have path segments"))?
            .pop_if_empty()
            .push(user_id);
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        if let Some(snippet_chars) = snippet_chars {
            url.query_pairs_mut()
                .append_pair("snippet_chars", &snippet_chars.to_string());
        }

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
