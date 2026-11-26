//! Byte-bounded header acquisition for whole-snapshot synchronization.
use super::*;
use crate::outbound::network::ReadLimitError;

pub(super) const MAX_FOLDER_UIDS: usize = 250_000;
const MAX_RETAINED_BYTES: usize = 256 * 1024 * 1024;
const HEADER_TARGET_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
pub(super) struct SnapshotBudget {
    used: usize,
}
impl SnapshotBudget {
    /// Virtual Gmail feeds share MIME Arcs but clone their organization metadata.
    pub(super) fn retain(&mut self, message: &RemoteMessage, owns_mime: bool) -> Result<(), Error> {
        let string_bytes = |strings: &[String]| {
            strings
                .iter()
                .map(|value| value.len() + std::mem::size_of::<String>())
                .sum::<usize>()
        };
        let bytes = std::mem::size_of::<RemoteMessage>()
            + if owns_mime { message.mime.len() } else { 0 }
            + string_bytes(&message.flags)
            + message
                .gmail_labels
                .as_ref()
                .map_or(0, |labels| string_bytes(labels))
            + message.native_message_id.as_ref().map_or(0, String::len)
            + message.native_thread_id.as_ref().map_or(0, String::len);
        self.used = self
            .used
            .checked_add(bytes)
            .filter(|used| *used <= MAX_RETAINED_BYTES)
            .ok_or(Error::SnapshotTooLarge)?;
        Ok(())
    }
}

pub(super) struct HeaderBatch {
    largest_header: usize,
}
impl Default for HeaderBatch {
    fn default() -> Self {
        Self {
            largest_header: HEADER_TARGET_BYTES,
        }
    }
}
impl HeaderBatch {
    pub(super) fn count(&self) -> usize {
        (HEADER_TARGET_BYTES / self.largest_header.max(1)).clamp(1, 1000)
    }
    pub(super) fn observe(&mut self, fetched: &[async_imap::types::Fetch]) {
        if let Some(largest) = fetched
            .iter()
            .filter_map(|item| item.header())
            .map(<[u8]>::len)
            .max()
        {
            self.largest_header = largest.max(1);
        }
    }
}

/// One selected-folder fetch and its explicit response budget.
struct FetchBatch<'a> {
    folder: &'a str,
    epoch: u32,
    uids: &'a [u32],
    query: &'a str,
    limit: ResponseLimit,
}

impl ProtocolTransport {
    pub(super) async fn snapshot_inner(
        &self,
        c: &Credentials,
        known: &AccountState,
    ) -> Result<Vec<RemoteFolder>, Error> {
        timeout(SYNC_ROUND_BUDGET, async {
            let transfer = std::sync::Arc::new(TransferBudget::new(MAX_SESSION_BYTES));
            let mut retained = snapshot::SnapshotBudget::default();
            let mut session = self
                .imap_with_budget(&c.imap, Some(transfer.clone()))
                .await?;
            let mut catalog = self.folders(&mut session).await?;
            let mut preferences = match (&self.settings, c.binding) {
                (Some(settings), Some(binding)) => settings.preferences(binding).await?,
                _ => crate::domain::account_settings::FolderPreferences::default(),
            };
            preferences.retain_listed(catalog.iter().map(|(folder, _)| folder.id.as_str()));
            let capabilities = session
                .limit_response(ResponseLimit::Metadata)
                .capabilities()
                .await
                .map_err(|e| imap_error(e, false))?;
            let gmail = capabilities.has_str("X-GM-EXT-1");
            let gmail_plan = if gmail {
                gmail::all_path(&mut session)
                    .await?
                    .map(|path| gmail::Plan::new(&catalog, path))
            } else {
                None
            };
            if let Some(plan) = &gmail_plan {
                for (folder, path) in &mut catalog {
                    if plan.is_all(path) {
                        folder.role = FolderRole::Archive;
                    }
                }
            }
            let selected_folders = folder_roles::monitored_ids(&catalog, &preferences);
            let condstore = capabilities.has_str("CONDSTORE");
            let objectid = capabilities.has_str("OBJECTID");
            let mut result = Vec::new();
            let mut total = 0;
            let known_locations = known
                .locations
                .iter()
                .map(|location| {
                    (
                        (
                            location.folder_id.as_str(),
                            location.uid_validity,
                            location.uid,
                        ),
                        location,
                    )
                })
                .collect::<std::collections::BTreeMap<_, _>>();
            for (mut folder, path) in catalog {
                if gmail_plan.as_ref().is_some_and(|p| p.is_all(&path)) {
                    folder.role = FolderRole::Archive;
                }
                let detected_role = Some(folder.role);
                folder.role = preferences.role(&folder);
                let virtual_label = gmail_plan.as_ref().and_then(|p| p.label(&folder.id));
                folder.sync_enabled = preferences.syncs(&folder.id)
                    && selected_folders.contains(&folder.id)
                    && folder.role != FolderRole::Drafts;
                if (!preferences.syncs(&folder.id)
                    && !gmail_plan.as_ref().is_some_and(|p| p.is_all(&path)))
                    || folder.role == FolderRole::Drafts
                    || gmail_plan.as_ref().is_some_and(|p| !p.physical(&folder.id))
                    || (!selected_folders.contains(&folder.id)
                        && !gmail_plan.as_ref().is_some_and(|p| p.physical(&folder.id)))
                {
                    folder.sync_enabled = false;
                    let previous = known.folders.get(&folder.id);
                    let path = if gmail_plan.as_ref().is_some_and(|p| !p.physical(&folder.id)) {
                        previous.map(|f| f.path.clone()).unwrap_or(path)
                    } else {
                        path
                    };
                    result.push(RemoteFolder {
                        virtual_label,
                        uid_next: previous.and_then(|f| f.uid_next),
                        phantom: previous.and_then(|f| f.phantom.clone()),
                        detected_role,
                        monitored: false,
                        uid_validity: previous.map(|f| f.uid_validity).unwrap_or(0),
                        highest_modseq: previous.and_then(|f| f.highest_modseq),
                        sync_tier: SyncTier::Full,
                        folder,
                        path,
                        messages: Vec::new(),
                    });
                    continue;
                }
                use crate::domain::folder_health::{FolderStatus, PhantomFolder};
                let previous = known.folders.get(&folder.id);
                let status = session
                    .limit_response(ResponseLimit::Metadata)
                    .status(&path, "(UIDVALIDITY UIDNEXT MESSAGES)")
                    .await;
                let status = match status {
                    Ok(status) => FolderStatus {
                        uid_validity: status.uid_validity,
                        uid_next: status.uid_next,
                        messages: status.exists,
                    },
                    Err(async_imap::error::Error::No(_)) => FolderStatus::default(),
                    Err(error) => return Err(imap_error(error, false)),
                };
                let now = Utc::now().timestamp_millis();
                let marker = previous.and_then(|f| f.phantom.as_ref());
                let skip = marker.is_some_and(|p| p.skip(status, now));
                let selected = if skip {
                    None
                } else {
                    match if condstore {
                        session
                            .limit_response(ResponseLimit::Metadata)
                            .select_condstore(&path)
                            .await
                    } else {
                        session
                            .limit_response(ResponseLimit::Metadata)
                            .select(&path)
                            .await
                    } {
                        Ok(selected) => Some(selected),
                        Err(async_imap::error::Error::No(_)) => None,
                        Err(error) => return Err(imap_error(error, false)),
                    }
                };
                let Some(selected) = selected else {
                    folder.sync_enabled = false;
                    result.push(RemoteFolder {
                        virtual_label,
                        uid_next: previous.and_then(|f| f.uid_next),
                        phantom: if skip {
                            marker.cloned()
                        } else {
                            Some(PhantomFolder::failed(marker, status, now))
                        },
                        detected_role,
                        monitored: false,
                        uid_validity: previous.map(|f| f.uid_validity).unwrap_or(0),
                        highest_modseq: previous.and_then(|f| f.highest_modseq),
                        sync_tier: SyncTier::Full,
                        folder,
                        path,
                        messages: Vec::new(),
                    });
                    continue;
                };
                folder.total_items = Some(selected.exists);
                if usize::try_from(selected.exists).map_err(|_| Error::Invalid)?
                    > snapshot::MAX_FOLDER_UIDS
                {
                    return Err(Error::SnapshotTooLarge);
                }
                let epoch = selected.uid_validity.ok_or(Error::ConnectionUnavailable)?;
                let mut uids = session
                    .limit_response(ResponseLimit::Metadata)
                    .uid_search("ALL")
                    .await
                    .map_err(|e| imap_error(e, false))?
                    .into_iter()
                    .collect::<Vec<_>>();
                if uids.len() > snapshot::MAX_FOLDER_UIDS {
                    return Err(Error::SnapshotTooLarge);
                }
                uids.sort_unstable();
                total += uids.len();
                if total > MAX_MESSAGES {
                    return Err(Error::SnapshotTooLarge);
                }
                let previous = known
                    .folders
                    .get(&folder.id)
                    .filter(|f| f.uid_validity == epoch);
                let watermark = previous
                    .and_then(|f| f.highest_modseq)
                    .filter(|_| selected.highest_modseq.is_some());
                let tier = if watermark.is_some() {
                    SyncTier::Condstore
                } else {
                    SyncTier::Full
                };
                let mut messages = Vec::new();
                let mut offset = 0;
                let mut header_batch = snapshot::HeaderBatch::default();
                while offset < uids.len() {
                    let needs_headers =
                        !known_locations.contains_key(&(folder.id.as_str(), epoch, uids[offset]));
                    let count = if needs_headers {
                        header_batch.count()
                    } else {
                        1000
                    };
                    let count = uids[offset..]
                        .iter()
                        .take(count)
                        .take_while(|uid| {
                            known_locations.contains_key(&(folder.id.as_str(), epoch, **uid))
                                != needs_headers
                        })
                        .count();
                    let mut chunk = &uids[offset..offset + count];
                    let native = identity::fetch_native(
                        &mut session,
                        &chunk
                            .iter()
                            .map(u32::to_string)
                            .collect::<Vec<_>>()
                            .join(","),
                        gmail,
                        objectid,
                    )
                    .await?;
                    let mut fields = String::from("UID FLAGS INTERNALDATE RFC822.SIZE");
                    if gmail {
                        fields.push_str(" X-GM-MSGID");
                    }
                    if selected.highest_modseq.is_some() {
                        fields.push_str(" MODSEQ");
                    }
                    let new_uids = chunk.iter().any(|uid| {
                        !known_locations.contains_key(&(folder.id.as_str(), epoch, *uid))
                    });
                    if new_uids {
                        fields.push_str(" BODY.PEEK[HEADER]");
                    }
                    let query = match watermark {
                        Some(n) => format!("({fields}) (CHANGEDSINCE {n})"),
                        None => format!("({fields})"),
                    };
                    let (next_session, mut fetched, used) = self
                        .fetch_snapshot_batch(
                            session,
                            c,
                            FetchBatch {
                                folder: &path,
                                epoch,
                                uids: chunk,
                                query: &query,
                                limit: if needs_headers {
                                    ResponseLimit::Headers
                                } else {
                                    ResponseLimit::Metadata
                                },
                            },
                            transfer.clone(),
                        )
                        .await?;
                    session = next_session;
                    chunk = &chunk[..used];
                    offset += used;
                    if fetched.len() > chunk.len() {
                        return Err(Error::Throttled);
                    }
                    let fetched_uids = fetched
                        .iter()
                        .filter_map(|f| f.uid)
                        .collect::<std::collections::BTreeSet<_>>();
                    for uid in chunk.iter().filter(|uid| !fetched_uids.contains(uid)) {
                        let cached = known_locations
                            .get(&(folder.id.as_str(), epoch, *uid))
                            .and_then(|l| known.messages.get(&l.message_id));
                        if let Some(cached) = cached {
                            use nom::{
                                IResult, Parser, bytes::complete::tag,
                                character::complete::u64 as number, sequence::preceded,
                            };
                            let parsed: IResult<&str, u64> =
                                preceded(tag("v1:"), number).parse(&cached.version);
                            let cached_message = RemoteMessage {
                                gmail_labels: native
                                    .get(uid)
                                    .and_then(|(_, _, labels)| labels.clone()),
                                uid: *uid,
                                native_message_id: native.get(uid).and_then(|(m, _, _)| m.clone()),
                                native_thread_id: native.get(uid).and_then(|(_, t, _)| t.clone()),
                                flags: cached.flags.clone(),
                                size: cached.size,
                                mime: STANDARD
                                    .decode(&cached.mime_base64)
                                    .map_err(|_| Error::ConnectionUnavailable)?
                                    .into(),
                                received_at: cached.received_at,
                                modseq: parsed.ok().map(|(_, n)| n),
                                gmail_message_id: cached
                                    .id
                                    .strip_prefix("g:")
                                    .and_then(|s| u64::from_str_radix(s, 16).ok()),
                            };
                            retained.retain(&cached_message, true)?;
                            messages.push(cached_message);
                        } else {
                            // A new UID is always read, even if a broken server omits it from CHANGEDSINCE.
                            fetched.extend(
                                session
                                    .limit_response(ResponseLimit::Headers)
                                    .uid_fetch(uid.to_string(), format!("({fields})"))
                                    .await
                                    .map_err(|e| imap_error(e, false))?
                                    .take(1001)
                                    .try_collect::<Vec<_>>()
                                    .await
                                    .map_err(|e| imap_error(e, false))?,
                            );
                        }
                    }
                    if fetched.len() > chunk.len() {
                        return Err(Error::Throttled);
                    }
                    if needs_headers {
                        header_batch.observe(&fetched);
                    }
                    for item in fetched {
                        let uid = item.uid.ok_or(Error::ConnectionUnavailable)?;
                        if chunk.binary_search(&uid).is_err() {
                            return Err(Error::ConnectionUnavailable);
                        }
                        let cached = known_locations
                            .get(&(folder.id.as_str(), epoch, uid))
                            .and_then(|l| known.messages.get(&l.message_id));
                        let mime = if let Some(header) = item.header() {
                            header.to_vec()
                        } else if let Some(cached) = cached {
                            STANDARD
                                .decode(&cached.mime_base64)
                                .map_err(|_| Error::ConnectionUnavailable)?
                        } else {
                            let source = session
                                .limit_response(ResponseLimit::Headers)
                                .uid_fetch(uid.to_string(), "BODY.PEEK[HEADER]")
                                .await
                                .map_err(|e| imap_error(e, false))?
                                .take(1001)
                                .try_collect::<Vec<_>>()
                                .await
                                .map_err(|e| imap_error(e, false))?;
                            source
                                .first()
                                .and_then(|f| f.header())
                                .ok_or(Error::ConnectionUnavailable)?
                                .to_vec()
                        };
                        if mime.len() > 25 * 1024 * 1024 {
                            return Err(Error::Throttled);
                        }
                        let message = RemoteMessage {
                            gmail_labels: native
                                .get(&uid)
                                .and_then(|(_, _, labels)| labels.clone()),
                            uid: item.uid.ok_or(Error::ConnectionUnavailable)?,
                            native_message_id: native.get(&uid).and_then(|(m, _, _)| m.clone()),
                            native_thread_id: native.get(&uid).and_then(|(_, t, _)| t.clone()),
                            flags: item.flags().map(flag_name).collect(),
                            size: item.size.ok_or(Error::ConnectionUnavailable)?,
                            mime: mime.into(),
                            received_at: item
                                .internal_date()
                                .map(|d| d.with_timezone(&Utc))
                                .unwrap_or(chrono::DateTime::UNIX_EPOCH),
                            modseq: item.modseq,
                            gmail_message_id: item.gmail_msg_id().copied(),
                        };
                        retained.retain(&message, true)?;
                        messages.push(message);
                    }
                }
                result.push(RemoteFolder {
                    virtual_label,
                    uid_next: selected.uid_next,
                    phantom: None,
                    detected_role,
                    monitored: true,
                    folder,
                    path,
                    uid_validity: epoch,
                    highest_modseq: selected.highest_modseq,
                    sync_tier: tier,
                    messages,
                });
            }
            if let Some(plan) = gmail_plan {
                plan.project(&mut result, &preferences, &selected_folders, &mut retained)?;
            }
            session
                .limit_response(ResponseLimit::Metadata)
                .logout()
                .await
                .map_err(|e| imap_error(e, false))?;
            Ok(result)
        })
        .await
        .map_err(|_| Error::ConnectionUnavailable)?
    }

    /// Discard a poisoned socket before retrying a smaller byte-targeted batch.
    /// The shared wire budget survives every reconnect and discarded response.
    #[tracing::instrument(skip_all, err)]
    async fn fetch_snapshot_batch(
        &self,
        mut session: Session<Stream>,
        credentials: &Credentials,
        batch: FetchBatch<'_>,
        transfer: std::sync::Arc<TransferBudget>,
    ) -> Result<(Session<Stream>, Vec<async_imap::types::Fetch>, usize), Error> {
        let FetchBatch {
            folder,
            epoch,
            uids,
            query,
            limit,
        } = batch;
        let mut count = uids.len();
        loop {
            let set = uids[..count]
                .iter()
                .map(u32::to_string)
                .collect::<Vec<_>>()
                .join(",");
            let fetched = timeout(IO_TIMEOUT, async {
                session
                    .limit_response(limit)
                    .uid_fetch(set, query)
                    .await?
                    .take(count + 1)
                    .try_collect::<Vec<_>>()
                    .await
            })
            .await
            .map_err(|_| Error::ConnectionTimedOut)?;
            match fetched {
                Ok(fetched) => return Ok((session, fetched, count)),
                Err(error) => {
                    let oversized = matches!(&error, async_imap::error::Error::Io(error)
                        if error.get_ref().and_then(|error| error.downcast_ref::<ReadLimitError>()).is_some_and(|limit| matches!(limit, ReadLimitError::Response)));
                    if !oversized {
                        return Err(imap_error(error, false));
                    }
                    if count == 1 {
                        return Err(Error::SnapshotTooLarge);
                    }
                    drop(session);
                    count = (count / 2).max(1);
                    session = self
                        .imap_with_budget(&credentials.imap, Some(transfer.clone()))
                        .await?;
                    let selected = session
                        .limit_response(ResponseLimit::Metadata)
                        .select(folder)
                        .await
                        .map_err(|error| imap_error(error, false))?;
                    if selected.uid_validity != Some(epoch) {
                        return Err(Error::Conflict);
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod test;
