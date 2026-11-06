//! How much mail an Outlook mailbox has received from a sender domain.

use chrono::{DateTime, Utc};
use serde::de::IgnoredAny;

use super::{OutlookApiClientRepository, wire};
use crate::domain::models::{AccessToken, EmailApiError, SenderDomain};
use crate::domain::ports::MailboxSenderActivityClient;

#[cfg(test)]
mod test;

/// Graph search has no count, so the first page is counted: enough to rank
/// senders, and one request per domain.
const MAX_COUNTED_MESSAGES: &str = "50";

impl MailboxSenderActivityClient for OutlookApiClientRepository {
    async fn count_messages_from_domain(
        &self,
        token: &AccessToken,
        domain: &SenderDomain,
        since: DateTime<Utc>,
    ) -> Result<u32, EmailApiError> {
        let mut url = self.endpoint(&["me", "messages"])?;
        url.query_pairs_mut()
            .append_pair("$search", &sender_domain_search(domain, since))
            .append_pair("$select", "id")
            .append_pair("$top", MAX_COUNTED_MESSAGES);
        let page: wire::Page<IgnoredAny> = self.get(token, url).await?;
        Ok(u32::try_from(page.value.len()).unwrap_or(u32::MAX))
    }
}

/// KQL for mail from `domain` received on or after `since`'s UTC date. Graph
/// requires the whole `$search` value in double quotes; a [`SenderDomain`]
/// holds no quote, space or operator that could change the query.
fn sender_domain_search(domain: &SenderDomain, since: DateTime<Utc>) -> String {
    format!(
        "\"from:{domain} AND received>={}\"",
        since.format("%Y-%m-%d")
    )
}
