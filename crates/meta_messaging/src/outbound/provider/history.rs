//! Official history APIs. Cursors are opaque values, never token-bearing next URLs.
use super::*;
use crate::domain::history::HistoryPage;

impl HttpMetaProvider {
    pub(super) async fn request_whatsapp_history_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        contacts: bool,
    ) -> PortResult<String> {
        let result=self.graph(Provider::Whatsapp,token,Method::POST,&[c.account_id.as_str(),"smb_app_data"],&[],
            Some(&json!({"messaging_product":"whatsapp","sync_type":if contacts{"smb_app_state_sync"}else{"history"}}))).await?;
        let id = required(&result, "request_id")?;
        if id.len() > 512 {
            return Err(MessagingError::ProviderRejected.into());
        }
        Ok(id.to_owned())
    }
    pub(super) async fn instagram_history_impl(
        &self,
        c: &Connection,
        token: &AccessToken,
        after: Option<&str>,
    ) -> PortResult<HistoryPage> {
        let mut params = vec![
            ("platform", "instagram"),
            ("limit", "1"),
            (
                "fields",
                "id,messages.limit(20){id,created_time,from,to,message,attachments}",
            ),
        ];
        if let Some(cursor) = after {
            params.push(("after", cursor));
        }
        let page = self
            .graph(
                Provider::Instagram,
                token,
                Method::GET,
                &[c.account_id.as_str(), "conversations"],
                &params,
                None,
            )
            .await?;
        decode_page(c, &page).map_err(Into::into)
    }
}

fn decode_page(c: &Connection, page: &Value) -> Result<HistoryPage, MessagingError> {
    let conversations = page["data"]
        .as_array()
        .ok_or(MessagingError::ProviderRejected)?;
    if conversations.len() > 1 {
        return Err(MessagingError::ProviderRejected);
    }
    let mut messages = Vec::new();
    for conversation in conversations {
        let rows = conversation["messages"]["data"]
            .as_array()
            .ok_or(MessagingError::ProviderRejected)?;
        if rows.len() > 20 {
            return Err(MessagingError::ProviderRejected);
        }
        for row in rows {
            // Deleted/unavailable content has no participants; don't invent a customer channel.
            if row["from"].is_null() || row["to"].is_null() {
                continue;
            }
            messages.push(decode_message(c, row)?);
        }
    }
    messages.sort_by(|a, b| {
        a.timestamp
            .cmp(&b.timestamp)
            .then_with(|| a.message_id.as_str().cmp(b.message_id.as_str()))
    });
    let next = if page["paging"]["next"].is_null() {
        None
    } else {
        let cursor = required(&page["paging"]["cursors"], "after")?;
        if cursor.len() > 4096 || cursor.chars().any(char::is_control) {
            return Err(MessagingError::ProviderRejected);
        }
        Some(cursor.to_owned())
    };
    Ok(HistoryPage { messages, next })
}
fn decode_message(c: &Connection, m: &Value) -> Result<IncomingMessage, MessagingError> {
    let sender = required(&m["from"], "id")?;
    let recipients = m["to"]["data"]
        .as_array()
        .ok_or(MessagingError::ProviderRejected)?;
    if recipients.len() != 1 {
        return Err(MessagingError::ProviderRejected);
    }
    let recipient = required(&recipients[0], "id")?;
    let (direction, customer) = if sender == c.account_id.as_str() {
        (Direction::Outbound, &recipients[0])
    } else if recipient == c.account_id.as_str() {
        (Direction::Inbound, &m["from"])
    } else {
        return Err(MessagingError::ProviderRejected);
    };
    let handle = customer["username"].as_str().map(|s| {
        s.chars()
            .filter(|c| !c.is_control())
            .take(128)
            .collect::<String>()
    });
    let mut media = Vec::new();
    let mut unavailable = false;
    if let Some(attachments) = m["attachments"]["data"].as_array() {
        if attachments.len() > 10 {
            return Err(MessagingError::ProviderRejected);
        }
        for a in attachments {
            let source = [
                ("image_data", MediaKind::Image),
                ("video_data", MediaKind::Video),
                ("audio_data", MediaKind::Audio),
            ]
            .into_iter()
            .find_map(|(field, kind)| a[field]["url"].as_str().map(|url| (kind, url)))
            .or_else(|| a["file_url"].as_str().map(|url| (MediaKind::Document, url)));
            if let Some((kind, url)) = source {
                media.push(IncomingMedia {
                    kind,
                    id: None,
                    url: Some(url.to_owned()),
                    mime_type: None,
                    filename: a["name"].as_str().map(str::to_owned),
                    sha256: None,
                });
            } else {
                unavailable = true;
            }
        }
    }
    let mut content = m["message"].as_str().unwrap_or_default().to_owned();
    if content.len() > 64 * 1024 {
        return Err(MessagingError::ProviderRejected);
    }
    if unavailable || (content.trim().is_empty() && media.is_empty()) {
        if !content.is_empty() {
            content.push_str("\n\n");
        }
        content.push_str("Content not provided by Instagram. View it in the original app.");
    }
    let timestamp = DateTime::parse_from_rfc3339(required(m, "created_time")?)
        .or_else(|_| {
            DateTime::parse_from_str(
                required(m, "created_time").unwrap_or_default(),
                "%Y-%m-%dT%H:%M:%S%z",
            )
        })
        .map_err(|_| MessagingError::ProviderRejected)?
        .with_timezone(&Utc);
    Ok(IncomingMessage {
        provider: Provider::Instagram,
        account_id: c.account_id.clone(),
        customer_id: required(customer, "id")?.to_owned().try_into()?,
        message_id: required(m, "id")?.to_owned().try_into()?,
        author_name: handle.as_ref().map(|h| format!("@{h}")),
        author_handle: handle,
        content,
        timestamp,
        direction,
        provenance: Provenance::OnboardingHistory,
        message_type: "history".into(),
        reply_to: None,
        media,
    })
}

#[cfg(all(test, feature = "axum"))]
mod test;
