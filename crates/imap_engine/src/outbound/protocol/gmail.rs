//! Gmail indexes three physical folders and derives label feeds from All Mail.
use super::*;
use std::collections::BTreeMap;

pub(super) async fn all_path(session: &mut Session<Stream>) -> Result<Option<String>, Error> {
    let names = session
        .limit_response(ResponseLimit::Catalog)
        .list(Some(""), Some("*"))
        .await
        .map_err(|e| imap_error(e, false))?
        .take(1001)
        .try_collect::<Vec<_>>()
        .await
        .map_err(|e| imap_error(e, false))?;
    if names.len() > 1000 {
        return Err(Error::Throttled);
    }
    Ok(names
        .into_iter()
        .find(|n| n.attributes().contains(&imap_proto::NameAttribute::All))
        .map(|n| n.name().to_owned()))
}
pub(super) struct Plan {
    all: String,
    labels: BTreeMap<String, String>,
}
impl Plan {
    pub(super) fn new(catalog: &[(Folder, String)], all: String) -> Self {
        let labels = catalog
            .iter()
            .map(|(f, path)| {
                let label = if path == &all {
                    "\\All".to_owned()
                } else {
                    match f.role {
                        FolderRole::Inbox => "\\Inbox".into(),
                        FolderRole::Sent => "\\Sent".into(),
                        FolderRole::Drafts => "\\Drafts".into(),
                        FolderRole::Junk => "\\Spam".into(),
                        FolderRole::Trash => "\\Trash".into(),
                        _ => folder_roles::display_path(path),
                    }
                };
                (f.id.clone(), label)
            })
            .collect();
        Self { all, labels }
    }
    pub(super) fn label(&self, id: &str) -> Option<String> {
        self.labels.get(id).cloned()
    }
    pub(super) fn physical(&self, id: &str) -> bool {
        self.labels
            .get(id)
            .is_some_and(|l| matches!(l.as_str(), "\\All" | "\\Spam" | "\\Trash"))
    }
    pub(super) fn is_all(&self, path: &str) -> bool {
        path == self.all
    }
    pub(super) fn project(
        &self,
        folders: &mut [RemoteFolder],
        prefs: &crate::domain::account_settings::FolderPreferences,
        selected: &std::collections::BTreeSet<String>,
        retained: &mut super::snapshot::SnapshotBudget,
    ) -> Result<(), Error> {
        let Some(all_index) = folders
            .iter()
            .position(|f| f.path == self.all && f.monitored)
        else {
            return Ok(());
        };
        let all = &folders[all_index];
        let epoch = all.uid_validity;
        let next = all.uid_next;
        let watermark = all.highest_modseq;
        let tier = all.sync_tier;
        let messages = std::mem::take(&mut folders[all_index].messages);
        for folder in folders.iter_mut() {
            let Some(label) = self.labels.get(&folder.folder.id) else {
                continue;
            };
            folder.virtual_label = Some(label.clone());
            if label == "\\All" && !prefs.syncs(&folder.folder.id) {
                folder.folder.sync_enabled = false;
                continue;
            }
            if self.physical(&folder.folder.id)
                || !prefs.syncs(&folder.folder.id)
                || !selected.contains(&folder.folder.id)
                || label == "\\Drafts"
            {
                continue;
            }
            folder.path = self.all.clone();
            folder.uid_validity = epoch;
            folder.uid_next = next;
            folder.highest_modseq = watermark;
            folder.sync_tier = tier;
            folder.monitored = true;
            folder.folder.sync_enabled = true;
            let mut projected = Vec::new();
            for message in messages.iter().filter(|message| {
                message
                    .gmail_labels
                    .as_ref()
                    .is_some_and(|labels| labels.iter().any(|value| value == label))
            }) {
                retained.retain(message, false)?;
                projected.push(message.clone());
            }
            folder.messages = projected;
            folder.folder.total_items = Some(folder.messages.len().try_into().unwrap_or(u32::MAX));
        }
        folders[all_index].messages = messages;
        Ok(())
    }
}

/// Domain labels are UTF-8; only this outbound boundary encodes wire names.
pub(super) fn wire_labels(labels: &std::collections::BTreeSet<String>) -> Result<String, Error> {
    labels
        .iter()
        .map(|label| quoted(&folder_roles::wire_path(label)))
        .collect::<Result<Vec<_>, _>>()
        .map(|labels| labels.join(" "))
}

#[cfg(test)]
mod test;
