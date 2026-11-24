use crate::EmailServiceClient;
use models_email::email::service::message::RecentInboxMessagesResponse;

pub use models_email::email::service::message::RecentMailFolder;

#[cfg(test)]
mod test;

/// A read of the last days of a user's mail.
#[derive(Debug, Clone, Copy)]
pub struct InboxWindow {
    /// Folder to read across the user's mailboxes.
    pub folder: RecentMailFolder,
    /// 1 to 30.
    pub days: u16,
    /// 1 to 500.
    pub limit: u16,
    /// How many of the newest carry a snippet.
    pub texts: u16,
    /// 1 to 500.
    pub snippet_chars: u16,
}

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
        let mut url = self.recent_messages_url(user_id)?;
        url.query_pairs_mut()
            .append_pair("limit", &limit.to_string());
        if let Some(snippet_chars) = snippet_chars {
            url.query_pairs_mut()
                .append_pair("snippet_chars", &snippet_chars.to_string());
        }
        self.read_recent_messages(url).await
    }

    /// Messages in `window.folder` across `user_id`'s own mailboxes in the last
    /// `window.days` days (at most 30), newest first, at most `window.limit`
    /// (500) of them, read straight from Gmail and Outlook. Only the newest
    /// `window.texts` carry a snippet, of up to `window.snippet_chars`.
    #[tracing::instrument(
        skip_all,
        fields(
            folder = window.folder.as_ref(),
            days = window.days,
            limit = window.limit,
            texts = window.texts,
            snippet_chars = window.snippet_chars,
        ),
        err
    )]
    pub async fn get_inbox_window(
        &self,
        user_id: &str,
        window: InboxWindow,
    ) -> anyhow::Result<RecentInboxMessagesResponse> {
        let mut url = self.recent_messages_url(user_id)?;
        {
            let mut query = url.query_pairs_mut();
            query
                .append_pair("days", &window.days.to_string())
                .append_pair("limit", &window.limit.to_string())
                .append_pair("texts", &window.texts.to_string())
                .append_pair("snippet_chars", &window.snippet_chars.to_string());
            match window.folder {
                RecentMailFolder::Inbox => {}
                RecentMailFolder::Sent => {
                    query.append_pair("folder", window.folder.as_ref());
                }
            }
        }
        self.read_recent_messages(url).await
    }

    fn recent_messages_url(&self, user_id: &str) -> anyhow::Result<reqwest::Url> {
        let mut url = reqwest::Url::parse(&format!("{}/internal/recent_messages/", self.url))?;
        url.path_segments_mut()
            .map_err(|()| anyhow::anyhow!("email service url cannot have path segments"))?
            .pop_if_empty()
            .push(user_id);
        Ok(url)
    }

    /// Errors leave out the URL: its path holds the user id, an email
    /// address, and the callers' spans record their errors.
    async fn read_recent_messages(
        &self,
        url: reqwest::Url,
    ) -> anyhow::Result<RecentInboxMessagesResponse> {
        let mut trace_headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut trace_headers);

        let response = self
            .client
            .get(url)
            .headers(trace_headers)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(reqwest::Error::without_url)?;
        Ok(response.json().await.map_err(reqwest::Error::without_url)?)
    }
}
