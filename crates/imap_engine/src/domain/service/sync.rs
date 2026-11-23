//! Stable identities and resumable folder journals.
use super::*;
#[derive(Serialize, Deserialize)]
struct Cursor {
    folder_id: String,
    epoch: u32,
    sequence: u64,
    initial_after: Option<String>,
}
pub(super) fn selection(op: &Operation) -> Result<StateSelection, Error> {
    Ok(match op {
        Operation::Sync => StateSelection::Sync,
        Operation::Apply { id, .. } => StateSelection::Message(id.clone()),
        Operation::Folders => StateSelection::Catalog,
        Operation::Message { id }
        | Operation::Organization { id }
        | Operation::Attachment { id, .. } => StateSelection::Message(id.clone()),
        Operation::RecentInbox { limit } => StateSelection::Recent((*limit).min(100)),
        Operation::Changes { folder, position } => {
            let cursor = position
                .as_ref()
                .map(|p| {
                    let bytes = STANDARD.decode(p).map_err(|_| Error::CursorOutdated)?;
                    serde_json::from_slice::<Cursor>(&bytes).map_err(|_| Error::CursorOutdated)
                })
                .transpose()?;
            StateSelection::Changes {
                folder: folder.clone(),
                after: cursor
                    .as_ref()
                    .map(|c| c.initial_after.clone())
                    .unwrap_or(Some(String::new())),
                sequence: cursor.map(|c| c.sequence).unwrap_or(0),
            }
        }
        Operation::CreateDraft { input } => StateSelection::Draft {
            id: format!("m:{}", input.correlation),
            reply_to: input.reply_to.clone(),
        },
        Operation::UpdateDraft { id, input, .. } => StateSelection::Draft {
            id: id.clone(),
            reply_to: input.reply_to.clone(),
        },
        Operation::FindDrafts { correlation } => StateSelection::Draft {
            id: format!("m:{correlation}"),
            reply_to: None,
        },
        Operation::GetDraft { id }
        | Operation::DeleteDraft { id, .. }
        | Operation::Attachments { id }
        | Operation::AddAttachment { id, .. }
        | Operation::DeleteAttachment { id, .. }
        | Operation::CreateUpload { id, .. }
        | Operation::Submit { id } => StateSelection::Draft {
            id: id.clone(),
            reply_to: None,
        },
        Operation::InspectUpload { id } | Operation::UploadRange { id, .. } => {
            StateSelection::Upload(*id)
        }
    })
}

pub(super) fn changes(
    state: &AccountState,
    folder: &str,
    position: Option<&str>,
) -> Result<ChangePage, Error> {
    let folder = state.folders.get(folder).ok_or(Error::NotFound)?;
    let cursor = if let Some(position) = position {
        serde_json::from_slice::<Cursor>(
            &STANDARD
                .decode(position)
                .map_err(|_| Error::CursorOutdated)?,
        )
        .map_err(|_| Error::CursorOutdated)?
    } else {
        Cursor {
            folder_id: folder.folder.id.clone(),
            epoch: folder.uid_validity,
            sequence: folder.sequence,
            initial_after: Some(String::new()),
        }
    };
    if cursor.folder_id != folder.folder.id
        || cursor.epoch != folder.uid_validity
        || cursor.sequence > folder.sequence
    {
        return Err(Error::CursorOutdated);
    }
    let (changed, removed, next, more) = if let Some(after) = cursor.initial_after {
        let ids = state
            .locations
            .iter()
            .filter(|l| l.folder_id == folder.folder.id)
            .map(|l| l.message_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .filter(|id| id > &after)
            .take(PAGE_SIZE + 1)
            .collect::<Vec<_>>();
        let more = ids.len() > PAGE_SIZE;
        let changed = ids.into_iter().take(PAGE_SIZE).collect::<Vec<_>>();
        let next = Cursor {
            folder_id: cursor.folder_id,
            epoch: cursor.epoch,
            sequence: cursor.sequence,
            initial_after: if more { changed.last().cloned() } else { None },
        };
        (changed, Vec::new(), next, more)
    } else {
        if folder
            .journal
            .first()
            .is_some_and(|c| cursor.sequence.saturating_add(1) < c.sequence)
        {
            return Err(Error::CursorOutdated);
        }
        let records = folder
            .journal
            .iter()
            .filter(|c| c.sequence > cursor.sequence)
            .take(PAGE_SIZE + 1)
            .collect::<Vec<_>>();
        let more = records.len() > PAGE_SIZE;
        let records = records.into_iter().take(PAGE_SIZE).collect::<Vec<_>>();
        let mut latest = BTreeMap::new();
        for r in &records {
            latest.insert(r.id.clone(), r.removed);
        }
        let changed = latest
            .iter()
            .filter(|(_, removed)| !**removed)
            .map(|(id, _)| id.clone())
            .collect();
        let removed = latest
            .iter()
            .filter(|(_, removed)| **removed)
            .map(|(id, _)| id.clone())
            .collect();
        let next = Cursor {
            folder_id: cursor.folder_id,
            epoch: cursor.epoch,
            sequence: records
                .last()
                .map(|r| r.sequence)
                .unwrap_or(folder.sequence),
            initial_after: None,
        };
        (changed, removed, next, more)
    };
    Ok(ChangePage {
        changed,
        removed,
        position: STANDARD.encode(serde_json::to_vec(&next).map_err(|_| Error::Invalid)?),
        has_more: more,
        reader_revision: 1,
    })
}

/// Separate physical scan checkpoints from changes visible to the host.
#[derive(Default)]
pub(super) struct SnapshotChanges {
    pub(super) state_changed: bool,
    pub(super) mailbox_changed: bool,
}
impl SnapshotChanges {
    fn folder(&mut self, previous: Option<&FolderState>, current: &FolderState) {
        self.state_changed |= previous != Some(current);
        self.mailbox_changed |= previous.is_none_or(|old| {
            old.folder != current.folder
                || old.path != current.path
                || old.uid_validity != current.uid_validity
                || old.monitored != current.monitored
                || old.virtual_label != current.virtual_label
                || old.phantom != current.phantom
                || old.detected_role != current.detected_role
                || old.sequence != current.sequence
        });
    }
}

pub(super) fn merge_snapshot(
    state: &mut AccountState,
    remote: Vec<RemoteFolder>,
) -> Result<SnapshotChanges, Error> {
    let mut changed = SnapshotChanges::default();
    let old_folder_count = state.folders.len();
    let old_thread_count = state.thread_refs.len();
    let unmonitored = remote
        .iter()
        .filter(|f| !f.monitored)
        .map(|f| f.folder.id.clone())
        .collect::<BTreeSet<_>>();
    let mut live = remote
        .iter()
        .flat_map(|f| {
            f.messages
                .iter()
                .map(|m| (f.folder.id.clone(), f.uid_validity, m.uid))
        })
        .collect::<BTreeSet<_>>();
    live.extend(
        state
            .locations
            .iter()
            .filter(|l| unmonitored.contains(&l.folder_id))
            .map(|l| (l.folder_id.clone(), l.uid_validity, l.uid)),
    );
    let gmail_catalog = remote
        .iter()
        .filter_map(|f| {
            f.virtual_label
                .as_deref()
                .map(|label| (f.folder.id.clone(), (f.folder.role, label.to_owned())))
        })
        .collect::<BTreeMap<_, _>>();
    let old_locations = std::mem::take(&mut state.locations);
    let by_locator = old_locations
        .iter()
        .map(|l| ((l.folder_id.clone(), l.uid_validity, l.uid), l))
        .collect::<BTreeMap<_, _>>();
    let mut by_fingerprint: BTreeMap<&str, Vec<&Location>> = BTreeMap::new();
    let mut by_folder: BTreeMap<&str, Vec<&Location>> = BTreeMap::new();
    for l in &old_locations {
        if !live.contains(&(l.folder_id.clone(), l.uid_validity, l.uid)) {
            by_fingerprint.entry(&l.fingerprint).or_default().push(l);
        }
        by_folder.entry(&l.folder_id).or_default().push(l);
    }
    let sent_by_message_id = state
        .drafts
        .iter()
        .filter_map(|(id, d)| {
            d.frozen_content
                .as_ref()
                .unwrap_or(&d.input.content)
                .get("message_id")
                .and_then(Value::as_str)
                .map(|v| (v.trim_matches(['<', '>']).to_owned(), (id, d)))
        })
        .collect::<BTreeMap<_, _>>();
    let mut next_locations = Vec::new();
    let mut next_members = BTreeSet::new();
    let mut next_messages = BTreeMap::new();
    let mut folder_ids = BTreeSet::new();
    for remote in remote {
        let folder_id = remote.folder.id.clone();
        folder_ids.insert(folder_id.clone());
        let previous = state.folders.get(&folder_id).cloned();
        let mut folder = FolderState {
            monitored: remote.monitored,
            virtual_label: remote.virtual_label,
            uid_next: remote.uid_next,
            phantom: remote.phantom,
            detected_role: remote.detected_role,
            folder: remote.folder,
            path: remote.path,
            uid_validity: remote.uid_validity,
            highest_modseq: remote.highest_modseq,
            sync_tier: Some(remote.sync_tier),
            sequence: previous.as_ref().map(|f| f.sequence).unwrap_or(0),
            journal: previous
                .as_ref()
                .filter(|f| f.uid_validity == remote.uid_validity)
                .map(|f| f.journal.clone())
                .unwrap_or_default(),
        };
        if !remote.monitored {
            for location in by_folder.get(folder_id.as_str()).into_iter().flatten() {
                next_locations.push((*location).clone());
                if let Some(message) = state.messages.get(&location.message_id) {
                    next_messages
                        .entry(location.message_id.clone())
                        .or_insert_with(|| message.clone());
                }
            }
            changed.folder(previous.as_ref(), &folder);
            state.folders.insert(folder_id, folder);
            continue;
        }
        for item in remote.messages {
            let gmail_labels = item.gmail_labels.clone();
            let canonical_folder = gmail_labels
                .as_ref()
                .map(|labels| {
                    gmail_target(
                        gmail_catalog
                            .iter()
                            .map(|(id, (role, label))| (id.as_str(), *role, label.as_str())),
                        labels,
                        &folder_id,
                    )
                })
                .unwrap_or_else(|| folder_id.clone());
            let headers = match mailparse::parse_headers(&item.mime) {
                Ok((headers, _)) => headers,
                Err(_) => {
                    // One malformed header block cannot stall the account or erase its last good view.
                    if let Some(old) = by_locator
                        .get(&(folder_id.clone(), remote.uid_validity, item.uid))
                        .copied()
                        && let Some(message) = state.messages.get(&old.message_id)
                    {
                        next_messages.insert(old.message_id.clone(), message.clone());
                        next_members.insert((old.folder_id.clone(), old.message_id.clone()));
                        next_locations.push(old.clone());
                    }
                    tracing::warn!(
                        "IMAP message headers could not be parsed; preserving prior snapshot"
                    );
                    continue;
                }
            };
            let global = headers.get_first_value("Message-ID");
            let fingerprint = format!(
                "{:x}",
                Sha256::digest(
                    [
                        item.mime.as_ref(),
                        item.received_at.to_rfc3339().as_bytes(),
                        item.size.to_string().as_bytes()
                    ]
                    .concat()
                )
            );
            let old = by_locator
                .get(&(folder_id.clone(), remote.uid_validity, item.uid))
                .copied()
                .or_else(|| {
                    let locations = by_fingerprint.get_mut(fingerprint.as_str())?;
                    while let Some(l) = locations.pop() {
                        if !next_messages.contains_key(&l.message_id) {
                            return Some(l);
                        }
                    }
                    None
                });
            let sent = if folder.folder.role == FolderRole::Sent
                || gmail_labels
                    .as_ref()
                    .is_some_and(|labels| labels.iter().any(|l| l == "\\Sent"))
            {
                global
                    .as_deref()
                    .and_then(|g| sent_by_message_id.get(g.trim_matches(['<', '>'])).copied())
            } else {
                None
            };
            let id = if let Some((id, _)) = sent {
                id.clone()
            } else if let Some(native) = item.gmail_message_id {
                format!("g:{native:x}")
            } else if let Some(native) = item.native_message_id {
                native
            } else {
                old.map(|l| l.message_id.clone())
                    .unwrap_or_else(|| format!("m:{}", Uuid::now_v7()))
            };
            let prior = state.messages.get(&id);
            let refs = headers
                .get_first_value("References")
                .or_else(|| headers.get_first_value("In-Reply-To"));
            let thread = prior
                .map(|m| m.thread_id.clone())
                .or(item.native_thread_id)
                .or_else(|| sent.map(|(_, d)| d.draft.conversation_id.clone()))
                .or_else(|| {
                    refs.as_ref().and_then(|r| {
                        r.split_whitespace()
                            .rev()
                            .find_map(|r| state.thread_refs.get(r).cloned())
                    })
                })
                .unwrap_or_else(|| format!("t:{}", Uuid::now_v7()));
            if let Some(global) = global {
                state
                    .thread_refs
                    .entry(global)
                    .or_insert_with(|| thread.clone());
            }
            let mut flags = item.flags;
            flags.retain(|flag| flag != "\\Recent");
            flags.sort();
            let tags = gmail_labels
                .as_ref()
                .map(|labels| gmail_tags(labels))
                .unwrap_or_else(|| {
                    flags
                        .iter()
                        .filter(|s| !s.starts_with('\\'))
                        .cloned()
                        .collect()
                });
            let version = organization_version_with_labels(
                &canonical_folder,
                &flags,
                item.modseq,
                gmail_labels.as_deref(),
            )?;
            let message = Message {
                id: id.clone(),
                thread_id: thread,
                folder_id: canonical_folder,
                flags,
                tags,
                version,
                mime_base64: STANDARD.encode(&item.mime),
                source_complete: false,
                classification: None,
                received_at: item.received_at,
                size: item.size,
                is_sent: folder.folder.role == FolderRole::Sent || prior.is_some_and(|m| m.is_sent),
                draft_correlation: sent.map(|(_, d)| d.input.correlation),
            };
            if prior.is_none_or(|old| {
                old.version != message.version || old.mime_base64 != message.mime_base64
            }) {
                folder.sequence = folder.sequence.saturating_add(1);
                folder.journal.push(Change {
                    sequence: folder.sequence,
                    id: id.clone(),
                    removed: false,
                });
            }
            changed.mailbox_changed |= prior.is_none_or(|old| {
                old.version != message.version
                    || old.mime_base64 != message.mime_base64
                    || old.thread_id != message.thread_id
                    || old.received_at != message.received_at
                    || old.size != message.size
                    || old.is_sent != message.is_sent
                    || old.draft_correlation != message.draft_correlation
            });
            next_members.insert((folder_id.clone(), id.clone()));
            let location = Location {
                folder_id: folder_id.clone(),
                uid_validity: folder.uid_validity,
                uid: item.uid,
                message_id: id.clone(),
                fingerprint,
            };
            changed.state_changed |= by_locator
                .get(&(folder_id.clone(), remote.uid_validity, item.uid))
                .is_none_or(|old| **old != location);
            next_locations.push(location);
            next_messages.insert(id, message);
        }
        for old in by_folder.get(folder_id.as_str()).into_iter().flatten() {
            if !next_members.contains(&(folder_id.clone(), old.message_id.clone())) {
                folder.sequence = folder.sequence.saturating_add(1);
                folder.journal.push(Change {
                    sequence: folder.sequence,
                    id: old.message_id.clone(),
                    removed: true,
                });
            }
        }
        if folder.journal.len() > 10000 {
            folder.journal.drain(..folder.journal.len() - 10000);
        }
        changed.folder(previous.as_ref(), &folder);
        state.folders.insert(folder_id, folder);
    }
    changed.mailbox_changed |= old_folder_count != folder_ids.len()
        || state.folders.keys().any(|id| !folder_ids.contains(id));
    state.folders.retain(|id, _| folder_ids.contains(id));
    // Keep app-sent fallback snapshots even when a server has no Sent folder.
    for (id, message) in &state.messages {
        if message.draft_correlation.is_some() && !next_messages.contains_key(id) {
            next_messages.insert(id.clone(), message.clone());
        }
    }
    for (id, message) in &next_messages {
        if message.draft_correlation.is_some()
            && let Some(draft) = state.drafts.get_mut(id)
        {
            changed.state_changed |=
                draft.submission != Some(SubmissionOutcome::Accepted) || draft.draft.is_draft;
            draft.submission = Some(SubmissionOutcome::Accepted);
            draft.draft.is_draft = false;
        }
    }
    changed.state_changed |= changed.mailbox_changed
        || old_thread_count != state.thread_refs.len()
        || old_locations.len() != next_locations.len()
        || state.messages.len() != next_messages.len();
    state.messages = next_messages;
    state.locations = next_locations;
    Ok(changed)
}

/// Canonical organization concurrency token shared by sync and point writes.
pub(super) fn organization_version(
    folder: &str,
    flags: &[String],
    modseq: Option<u64>,
) -> Result<String, Error> {
    let mut flags = flags
        .iter()
        .filter(|flag| flag.as_str() != "\\Recent")
        .cloned()
        .collect::<Vec<_>>();
    flags.sort();
    Ok(format!(
        "v1:{}:{:x}",
        modseq.unwrap_or(0),
        Sha256::digest(serde_json::to_vec(&(folder, flags)).map_err(|_| Error::Invalid)?)
    ))
}

fn gmail_members(label: &str, labels: &[String]) -> bool {
    if labels
        .iter()
        .any(|l| matches!(l.as_str(), "\\Trash" | "\\Spam"))
        && !matches!(label, "\\Trash" | "\\Spam")
    {
        return false;
    }
    if label == "\\All" {
        !labels
            .iter()
            .any(|l| matches!(l.as_str(), "\\Trash" | "\\Spam"))
    } else {
        labels.iter().any(|l| l == label)
    }
}
fn gmail_target<'a>(
    folders: impl Iterator<Item = (&'a str, FolderRole, &'a str)>,
    labels: &[String],
    fallback: &str,
) -> String {
    folders
        .filter(|(_, _, label)| gmail_members(label, labels))
        .min_by_key(|(id, role, _)| {
            (
                match role {
                    FolderRole::Trash => 0,
                    FolderRole::Junk => 1,
                    FolderRole::Inbox => 2,
                    FolderRole::Archive => 3,
                    FolderRole::Sent => 4,
                    FolderRole::Drafts => 5,
                    FolderRole::Other => 6,
                },
                *id,
            )
        })
        .map(|(id, _, _)| id.to_owned())
        .unwrap_or_else(|| fallback.to_owned())
}
fn gmail_tags(labels: &[String]) -> Vec<String> {
    let mut tags = labels
        .iter()
        .filter(|l| !l.starts_with('\\'))
        .cloned()
        .collect::<Vec<_>>();
    tags.sort();
    tags.dedup();
    tags
}
/// Include Gmail label membership in optimistic concurrency even on servers without MODSEQ.
pub(super) fn remote_organization_version(
    folder: &str,
    facts: &RemoteMessage,
) -> Result<String, Error> {
    organization_version_with_labels(
        folder,
        &facts.flags,
        facts.modseq,
        facts.gmail_labels.as_deref(),
    )
}
fn organization_version_with_labels(
    folder: &str,
    flags: &[String],
    modseq: Option<u64>,
    labels: Option<&[String]>,
) -> Result<String, Error> {
    let base = organization_version(folder, flags, modseq)?;
    let Some(labels) = labels else {
        return Ok(base);
    };
    let mut labels = labels.to_vec();
    labels.sort();
    labels.dedup();
    Ok(format!(
        "{base}:{:x}",
        Sha256::digest(serde_json::to_vec(&labels).map_err(|_| Error::Invalid)?)
    ))
}
/// Apply fresh Gmail label facts to every derived feed, keeping its physical UID readable.
pub(super) fn gmail_projection(
    state: &mut AccountState,
    id: &str,
    facts: &RemoteMessage,
    physical: &Location,
) -> Result<(), Error> {
    let Some(labels) = facts.gmail_labels.as_ref() else {
        return Ok(());
    };
    let target = gmail_target(
        state.folders.iter().filter_map(|(id, f)| {
            f.virtual_label
                .as_deref()
                .map(|l| (id.as_str(), f.folder.role, l))
        }),
        labels,
        &physical.folder_id,
    );
    let message = state.messages.get_mut(id).ok_or(Error::NotFound)?;
    message.folder_id = target.clone();
    message.tags = gmail_tags(labels);
    message.flags = facts.flags.clone();
    message.flags.retain(|f| f != "\\Recent");
    message.flags.sort();
    message.is_sent |= labels.iter().any(|l| l == "\\Sent");
    message.version = remote_organization_version(&target, facts)?;
    for (folder_id, folder) in &mut state.folders {
        let Some(label) = folder.virtual_label.as_deref() else {
            continue;
        };
        let live = gmail_members(label, labels);
        let previous = state
            .locations
            .iter()
            .any(|l| l.folder_id == *folder_id && l.message_id == id);
        state
            .locations
            .retain(|l| l.folder_id != *folder_id || l.message_id != id);
        if live {
            let mut location = physical.clone();
            location.folder_id = folder_id.clone();
            // Every derived membership uses the freshly acknowledged physical incarnation and UID.
            folder.uid_validity = physical.uid_validity;
            state.locations.push(location);
        }
        if previous || live {
            folder.sequence = folder.sequence.saturating_add(1);
            folder.journal.push(Change {
                sequence: folder.sequence,
                id: id.to_owned(),
                removed: !live,
            });
            if folder.journal.len() > 10000 {
                folder.journal.drain(..folder.journal.len() - 10000);
            }
        }
    }
    Ok(())
}
