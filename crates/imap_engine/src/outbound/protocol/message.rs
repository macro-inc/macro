//! Bounded single-message facts for conditional organization writes.
use super::*;
impl ProtocolTransport {
    pub(super) async fn read_remote(
        &self,
        c: &Credentials,
        folder: &str,
        epoch: u32,
        uid: u32,
    ) -> Result<Option<RemoteMessage>, Error> {
        timeout(IO_TIMEOUT, async {
            let mut session = self.command_session(c).await?;
            let capabilities = session
                .limit_response(ResponseLimit::Metadata)
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?;
            let selected = if capabilities.has_str("CONDSTORE") {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select_condstore(folder)
                    .await
            } else {
                session
                    .limit_response(ResponseLimit::Metadata)
                    .select(folder)
                    .await
            }
            .map_err(|e| imap_error(e, false))?;
            if selected.uid_validity != Some(epoch) {
                return Err(Error::Conflict);
            }
            let native = identity::fetch_native(
                &mut session,
                &uid.to_string(),
                capabilities.has_str("X-GM-EXT-1"),
                capabilities.has_str("OBJECTID"),
            )
            .await?;
            let query = if selected.highest_modseq.is_some() {
                "(UID FLAGS INTERNALDATE RFC822.SIZE MODSEQ BODY.PEEK[HEADER])"
            } else {
                "(UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[HEADER])"
            };
            let fetched = session
                .limit_response(ResponseLimit::Metadata)
                .uid_fetch(uid.to_string(), query)
                .await
                .map_err(|e| imap_error(e, false))?
                .take(2)
                .try_collect::<Vec<_>>()
                .await
                .map_err(|e| imap_error(e, false))?;
            if fetched.len() > 1 {
                return Err(Error::ConnectionUnavailable);
            }
            let result = if let Some(item) = fetched.first() {
                Some(RemoteMessage {
                    gmail_labels: native.get(&uid).and_then(|(_, _, labels)| labels.clone()),
                    uid,
                    flags: item.flags().map(flag_name).collect(),
                    mime: item.header().ok_or(Error::ConnectionUnavailable)?.into(),
                    size: item.size.ok_or(Error::ConnectionUnavailable)?,
                    received_at: item
                        .internal_date()
                        .map(|d| d.with_timezone(&Utc))
                        .unwrap_or(chrono::DateTime::UNIX_EPOCH),
                    modseq: item.modseq,
                    gmail_message_id: item.gmail_msg_id().copied(),
                    native_message_id: native.get(&uid).and_then(|(m, _, _)| m.clone()),
                    native_thread_id: native.get(&uid).and_then(|(_, t, _)| t.clone()),
                })
            } else {
                None
            };
            self.return_command(c, session).await;
            Ok(result)
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }
}
