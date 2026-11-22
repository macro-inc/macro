//! Exact Sent-copy evidence and guarded, once-only Sent APPEND.
use super::*;

impl ProtocolTransport {
    #[tracing::instrument(skip_all, err)]
    pub(super) async fn save_sent_inner(
        &self,
        c: &Credentials,
        message_id: &str,
        mime: &[u8],
        allow_append: bool,
    ) -> Result<bool, Error> {
        if message_id.len() > 998 || message_id.chars().any(char::is_control) {
            return Err(Error::Invalid);
        }
        // Sent reconciliation runs under the command lease. Keep its socket
        // independent from user body reads, including the sync recovery path.
        let mut session = self.imap(&c.imap).await?;
        let mut catalog = self.folders(&mut session).await?;
        let mut preferences = match (&self.settings, c.binding) {
            (Some(settings), Some(binding)) => settings.preferences(binding).await?,
            _ => crate::domain::account_settings::FolderPreferences::default(),
        };
        preferences.retain_listed(catalog.iter().map(|(folder, _)| folder.id.as_str()));
        for (folder, _) in &mut catalog {
            folder.role = preferences.role(folder);
        }
        let mut copied = allow_append;
        if let Some((_, path)) = catalog
            .into_iter()
            .find(|(f, _)| f.role == FolderRole::Sent)
        {
            let selected = session
                .select(&path)
                .await
                .map_err(|e| imap_error(e, false))?;
            let query = format!("HEADER Message-ID {}", quoted(message_id)?);
            let candidates = session
                .uid_search(query)
                .await
                .map_err(|e| imap_error(e, false))?;
            if candidates.len() > 200 {
                return Err(Error::Throttled);
            }
            let mut found = std::collections::BTreeSet::new();
            if !candidates.is_empty() {
                let set = candidates
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join(",");
                let headers = session
                    .uid_fetch(set, "(UID BODY.PEEK[HEADER])")
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .take(201)
                    .try_collect::<Vec<_>>()
                    .await
                    .map_err(|e| imap_error(e, false))?;
                if headers.len() > 200 {
                    return Err(Error::Throttled);
                }
                for item in headers {
                    if item
                        .header()
                        .is_some_and(|header| exact_message_id(header, message_id))
                        && let Some(uid) = item.uid
                    {
                        found.insert(uid);
                    }
                }
            }
            if found.is_empty() {
                // Some interoperable servers do not index Message-ID for HEADER SEARCH.
                // Inspect a bounded recent UID window before risking another APPEND.
                let start = selected.uid_next.unwrap_or(1).saturating_sub(200).max(1);
                let recent = session
                    .uid_fetch(format!("{start}:*"), "(UID BODY.PEEK[HEADER])")
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .take(201)
                    .try_collect::<Vec<_>>()
                    .await
                    .map_err(|e| imap_error(e, false))?;
                if recent.len() > 200 {
                    return Err(Error::Throttled);
                }
                for item in recent {
                    let Some(header) = item.header() else {
                        continue;
                    };
                    if exact_message_id(header, message_id)
                        && let Some(uid) = item.uid
                    {
                        found.insert(uid);
                    }
                }
            }
            if found.len() > 1 {
                return Err(Error::ConnectionUnavailable);
            }
            if found.len() == 1 {
                copied = true;
            }
            let server_saves_copy = session
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?
                .has_str("X-GM-EXT-1");
            if found.is_empty() && !server_saves_copy && allow_append {
                session
                    .append(&path, Some("(\\Seen)"), None, mime)
                    .await
                    .map_err(|e| imap_error(e, false))?;
            } else if found.is_empty() {
                copied = false;
            }
        }
        drop(session);
        Ok(copied)
    }
}

// IMAP HEADER SEARCH is a substring match, so search hits alone cannot prove delivery.
fn exact_message_id(header: &[u8], expected: &str) -> bool {
    let Ok((headers, _)) = mailparse::parse_headers(header) else {
        return false;
    };
    let ids = headers
        .iter()
        .filter(|h| h.get_key().eq_ignore_ascii_case("Message-ID"))
        .collect::<Vec<_>>();
    if ids.len() != 1 {
        return false;
    }
    let value = ids[0].get_value();
    let value = value.trim();
    let value = value
        .strip_prefix('<')
        .and_then(|id| id.strip_suffix('>'))
        .unwrap_or(value);
    value == expected
}
