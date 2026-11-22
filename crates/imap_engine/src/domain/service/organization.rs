//! Bounded organization writes: refresh one UID, acknowledge its exact destination when available.
use super::*;
impl Engine {
    pub(super) async fn apply_organization(
        &self,
        a: &mut Account,
        id: String,
        request: ActionRequest,
    ) -> Result<Value, Error> {
        let previous = a.state.messages.get(&id).cloned().ok_or(Error::NotFound)?;
        let location = a
            .state
            .locations
            .iter()
            .find(|l| l.message_id == id && l.folder_id == previous.folder_id && l.uid > 0)
            .cloned()
            .ok_or(Error::ConnectionUnavailable)?;
        let source = a
            .state
            .folders
            .get(&location.folder_id)
            .cloned()
            .ok_or(Error::NotFound)?;
        let credentials = self
            .cipher
            .decrypt(a.binding.link_id, &a.user_id, &a.ciphertext)
            .await?;
        let current = self
            .transport
            .message(
                &credentials,
                &source.path,
                location.uid_validity,
                location.uid,
            )
            .await?
            .ok_or(Error::NotFound)?;
        let version = sync::remote_organization_version(&location.folder_id, &current)?;
        if request
            .expected_version
            .as_ref()
            .is_some_and(|v| v != &version)
        {
            return Err(Error::Conflict);
        }
        let action: MessageAction =
            serde_json::from_value(request.action).map_err(|_| Error::Invalid)?;
        let destination = match &action {
            MessageAction::MoveToFolder(target) => Some(
                a.state
                    .folders
                    .get(target.as_str())
                    .cloned()
                    .ok_or(Error::NotFound)?,
            ),
            MessageAction::Archive => Some(
                a.state
                    .folders
                    .values()
                    .find(|f| f.folder.role == FolderRole::Archive)
                    .cloned()
                    .ok_or(Error::Forbidden)?,
            ),
            _ => None,
        };
        let (remote, physical_move) =
            remote_action(&action, &source, destination.as_ref(), &current)?;
        let remote = if let Some(modseq) = current.modseq {
            RemoteAction::IfUnchanged {
                modseq,
                action: Box::new(remote),
            }
        } else {
            remote
        };
        let receipt = self
            .transport
            .apply(
                &credentials,
                &source.path,
                location.uid_validity,
                location.uid,
                remote,
            )
            .await?;
        // Once a provider write has succeeded, no busy follow-up may cause a
        // replay of the whole action. It must settle through reconciliation.
        let result = async {
            if current.gmail_labels.is_some() && !physical_move {
                let facts = self
                    .transport
                    .message(
                        &credentials,
                        &source.path,
                        location.uid_validity,
                        location.uid,
                    )
                    .await?
                    .ok_or(Error::ConnectionUnavailable)?;
                sync::gmail_projection(&mut a.state, &id, &facts, &location)?;
                let version = a.state.messages.get(&id).map(|m| m.version.clone());
                a.state.notification_pending = true;
                self.repository.save(a).await?;
                self.notify(a).await?;
                return value(WriteReceipt { id, version });
            }
            let mut message = previous;
            let mut observed_version = None;
            if let Some(destination) = destination {
                if destination.folder.id != source.folder.id && current.gmail_labels.is_none() {
                    push_change(&mut a.state, &source.folder.id, &id, true)?;
                }
                message.folder_id = destination.folder.id.clone();
                message.is_sent |= destination.folder.role == FolderRole::Sent;
                if let Some((epoch, uid)) = receipt
                    .destination_uid
                    .filter(|(epoch, _)| *epoch == destination.uid_validity)
                {
                    if current.gmail_labels.is_some()
                        && let Some(label) = destination
                            .virtual_label
                            .as_deref()
                            .filter(|l| !matches!(*l, "\\All" | "\\Trash" | "\\Spam"))
                    {
                        self.transport
                            .apply(
                                &credentials,
                                &destination.path,
                                epoch,
                                uid,
                                RemoteAction::GmailLabels {
                                    add: vec![label.to_owned()],
                                    remove: if label != "\\Inbox" {
                                        vec!["\\Inbox".into()]
                                    } else {
                                        Vec::new()
                                    },
                                },
                            )
                            .await?;
                    }
                    let facts = self
                        .transport
                        .message(&credentials, &destination.path, epoch, uid)
                        .await?
                        .ok_or(Error::ConnectionUnavailable)?;
                    apply_facts(&mut message, &facts)?;
                    a.state
                        .locations
                        .retain(|l| !(l.message_id == id && l.folder_id == source.folder.id));
                    a.state.locations.push(Location {
                        folder_id: destination.folder.id.clone(),
                        uid_validity: epoch,
                        uid,
                        message_id: id.clone(),
                        fingerprint: location.fingerprint.clone(),
                    });
                    if facts.gmail_labels.is_some() {
                        a.state.messages.insert(id.clone(), message);
                        let physical = Location {
                            folder_id: destination.folder.id.clone(),
                            uid_validity: epoch,
                            uid,
                            message_id: id.clone(),
                            fingerprint: location.fingerprint.clone(),
                        };
                        sync::gmail_projection(&mut a.state, &id, &facts, &physical)?;
                        let version = a.state.messages.get(&id).map(|m| m.version.clone());
                        a.state.notification_pending = true;
                        self.repository.save(a).await?;
                        self.notify(a).await?;
                        return value(WriteReceipt { id, version });
                    }
                    observed_version = Some(message.version.clone());
                } else {
                    // Preserve the old locator as move-identity evidence for the next sync. UID zero is
                    // an explicit unreadable destination membership, never sent to the remote server.
                    if !a
                        .state
                        .locations
                        .iter()
                        .any(|l| l.message_id == id && l.folder_id == destination.folder.id)
                    {
                        a.state.locations.push(Location {
                            folder_id: destination.folder.id.clone(),
                            uid_validity: destination.uid_validity,
                            uid: 0,
                            message_id: id.clone(),
                            fingerprint: location.fingerprint.clone(),
                        });
                    }
                    if current.gmail_labels.is_some() && destination.folder.id != source.folder.id {
                        push_change(&mut a.state, &source.folder.id, &id, true)?;
                    }
                    message.version = format!("pending:{}", Uuid::now_v7());
                }
                push_change(&mut a.state, &destination.folder.id, &id, false)?;
            } else {
                let facts = self
                    .transport
                    .message(
                        &credentials,
                        &source.path,
                        location.uid_validity,
                        location.uid,
                    )
                    .await?
                    .ok_or(Error::ConnectionUnavailable)?;
                apply_facts(&mut message, &facts)?;
                observed_version = Some(message.version.clone());
                push_change(&mut a.state, &source.folder.id, &id, false)?;
            }
            a.state.messages.insert(id.clone(), message);
            a.state.notification_pending = true;
            self.repository.save(a).await?;
            self.notify(a).await?;
            value(WriteReceipt {
                id,
                version: observed_version,
            })
        }
        .await;
        result.map_err(|error| match error {
            Error::AccountBusy => {
                tracing::warn!(
                    mail.stage = "organization-after-write",
                    "Mailbox busy after a provider write; reconciliation required"
                );
                Error::ConnectionUnavailable
            }
            error => error,
        })
    }
}
fn apply_facts(message: &mut Message, facts: &RemoteMessage) -> Result<(), Error> {
    message.flags = facts
        .flags
        .iter()
        .filter(|f| !f.eq_ignore_ascii_case("\\Recent"))
        .cloned()
        .collect();
    message.flags.sort();
    message.tags = message
        .flags
        .iter()
        .filter(|f| !f.starts_with('\\'))
        .cloned()
        .collect();
    message.version = sync::remote_organization_version(&message.folder_id, facts)?;
    Ok(())
}
fn push_change(
    state: &mut AccountState,
    folder: &str,
    id: &str,
    removed: bool,
) -> Result<(), Error> {
    let folder = state.folders.get_mut(folder).ok_or(Error::NotFound)?;
    folder.sequence = folder.sequence.checked_add(1).ok_or(Error::Invalid)?;
    folder.journal.push(Change {
        sequence: folder.sequence,
        id: id.into(),
        removed,
    });
    Ok(())
}

/// Resolve Gmail label changes explicitly; plain IMAP always keeps physical MOVE semantics.
fn remote_action(
    action: &MessageAction,
    source: &FolderState,
    destination: Option<&FolderState>,
    current: &RemoteMessage,
) -> Result<(RemoteAction, bool), Error> {
    let action = match action {
        MessageAction::SetRead(enabled) => RemoteAction::Flag {
            flag: "\\Seen".into(),
            enabled: *enabled,
        },
        MessageAction::SetFlagged(enabled) => RemoteAction::Flag {
            flag: "\\Flagged".into(),
            enabled: *enabled,
        },
        MessageAction::SetTags(tags) => {
            if let Some(labels) = &current.gmail_labels {
                if tags.iter().any(|tag| tag.starts_with('\\')) {
                    return Err(Error::Invalid);
                }
                let existing = labels
                    .iter()
                    .filter(|tag| !tag.starts_with('\\'))
                    .collect::<BTreeSet<_>>();
                let desired = tags.iter().collect::<BTreeSet<_>>();
                RemoteAction::GmailLabels {
                    add: desired
                        .difference(&existing)
                        .map(|s| (**s).clone())
                        .collect(),
                    remove: existing
                        .difference(&desired)
                        .map(|s| (**s).clone())
                        .collect(),
                }
            } else {
                RemoteAction::Keywords(tags.clone())
            }
        }
        MessageAction::MoveToFolder(_) | MessageAction::Archive => {
            let destination = destination.ok_or(Error::Invalid)?;
            if current.gmail_labels.is_some() && source.path == destination.path {
                let target = destination.virtual_label.as_deref().ok_or(Error::Invalid)?;
                let mut add = Vec::new();
                let mut remove = Vec::new();
                if target == "\\All" {
                    remove.push("\\Inbox".into());
                } else {
                    add.push(target.to_owned());
                    if let Some(label) = source.virtual_label.as_deref().filter(|label| {
                        *label != target && (*label == "\\Inbox" || !label.starts_with('\\'))
                    }) {
                        remove.push(label.to_owned());
                    }
                }
                return Ok((RemoteAction::GmailLabels { add, remove }, false));
            }
            return Ok((RemoteAction::Move(destination.path.clone()), true));
        }
    };
    Ok((action, false))
}

#[cfg(test)]
mod test;
