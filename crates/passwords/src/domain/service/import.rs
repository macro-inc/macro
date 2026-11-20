//! Import orchestration reuses ordinary create and TOTP authorization and recovery.
use super::*;
use futures::{StreamExt, stream};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    num::NonZeroUsize,
};
use tracing::Instrument;

// Four bounds pool pressure while retaining most of the measured throughput gain.
const IMPORT_CONCURRENCY: NonZeroUsize = NonZeroUsize::new(4).expect("nonzero concurrency");

/// Stable UUIDv7: preserve the import timestamp and derive its 74 random bits.
fn derive_v7(import_id: Uuid, namespace: &str, key: &str) -> Uuid {
    let mut hash = Sha256::new();
    hash.update(import_id.as_bytes());
    hash.update(namespace.as_bytes());
    hash.update(key.as_bytes());
    let digest = hash.finalize();
    let mut bytes = *import_id.as_bytes();
    bytes[6..].copy_from_slice(&digest[..10]);
    bytes[6] = (bytes[6] & 0x0f) | 0x70;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    Uuid::from_bytes(bytes)
}

/// How much longer, in UTF-8 bytes, lower case can make a name ('İ', two
/// bytes, lower-cases to three): match names arrive lower-cased by the client.
const MAX_LOWERCASE_GROWTH: usize = 3;

impl PasswordService {
    /// Visible items named like the given names, for an import's duplicate check.
    #[tracing::instrument(skip_all, err, name = "passwords.import.match", fields(
        team_id = %team.0, names = names.len() as i64, matched = tracing::field::Empty
    ))]
    pub async fn match_names(
        &self,
        actor: &Actor,
        team: TeamId,
        names: Vec<String>,
    ) -> Result<Vec<ItemView>, Error> {
        self.membership(actor, team).await?;
        if names.len() > vault::MAX_IMPORT_MATCH_NAMES
            || names
                .iter()
                .any(|name| name.len() > vault::MAX_NAME_BYTES * MAX_LOWERCASE_GROWTH)
        {
            return Err(Error::Invalid);
        }
        let admin = self.repository.is_team_admin(&actor.user_id, team).await?;
        let records = self.repository.matching(actor, team, &names).await?;
        let items = self.views(actor, team, records, admin).await?;
        tracing::Span::current().record("matched", items.len() as i64);
        Ok(items)
    }

    /// Import a bounded batch, retaining independent item failures for selective retries.
    pub async fn import_batch(
        &self,
        actor: &Actor,
        team: TeamId,
        import_id: Uuid,
        batch: ImportBatch,
    ) -> Result<ImportBatchResult, Error> {
        self.import_batch_concurrent(actor, team, import_id, batch, IMPORT_CONCURRENCY)
            .await
    }

    #[cfg(test)]
    pub(crate) async fn import_batch_at_concurrency(
        &self,
        actor: &Actor,
        team: TeamId,
        import_id: Uuid,
        batch: ImportBatch,
        concurrency: NonZeroUsize,
    ) -> Result<ImportBatchResult, Error> {
        self.import_batch_concurrent(actor, team, import_id, batch, concurrency)
            .await
    }

    #[tracing::instrument(skip_all, err, name = "passwords.import.batch", fields(
        team_id = %team.0, import_id = %import_id,
        item_count = batch.items.len() as i64, folder_count = batch.folders.len() as i64,
        created = tracing::field::Empty, already_present = tracing::field::Empty,
        failed = tracing::field::Empty, audit_failed = tracing::field::Empty,
        concurrency = tracing::field::Empty
    ))]
    async fn import_batch_concurrent(
        &self,
        actor: &Actor,
        team: TeamId,
        import_id: Uuid,
        batch: ImportBatch,
        concurrency: NonZeroUsize,
    ) -> Result<ImportBatchResult, Error> {
        self.membership(actor, team).await?;
        if import_id.get_version_num() != 7
            || import_id.get_variant() != uuid::Variant::RFC4122
            || batch.items.len() > vault::MAX_IMPORT_BATCH_ITEMS
            || batch.folders.len() > vault::MAX_IMPORT_BATCH_FOLDERS
        {
            return Err(Error::Invalid);
        }
        let folder_count = u8::try_from(batch.folders.len()).map_err(|_| Error::Invalid)?;
        let concurrency = concurrency.min(self.repository.import_capacity());
        tracing::Span::current().record("concurrency", concurrency.get() as i64);
        let mut keys = HashSet::new();
        let mut item_ids = HashSet::new();
        if batch.items.iter().any(|item| {
            !keys.insert(item.source_key.clone())
                || !item_ids.insert(derive_v7(import_id, "item", item.source_key.as_ref()))
        }) {
            return Err(Error::Invalid);
        }
        let mut folders = HashMap::new();
        let mut names = HashMap::new();
        // Validate the complete tree before creating any folders, including duplicate keys.
        for folder in &batch.folders {
            names.insert(folder.key.clone(), Self::folder_name(folder.name.clone())?);
            if folders.contains_key(&folder.key)
                || folder
                    .parent_key
                    .as_ref()
                    .is_some_and(|key| !folders.contains_key(key))
            {
                return Err(Error::Invalid);
            }
            folders.insert(
                folder.key.clone(),
                derive_v7(import_id, "folder", folder.key.as_ref()),
            );
        }
        let folder_phase =
            !matches!(&batch.target, ImportTarget::Root) || !batch.folders.is_empty();
        // This is the existing team-wide fence, shared only by distinct validated item IDs.
        let lease = match self.admit_member(actor, team, ItemId(Uuid::nil())).await {
            Err(error) if folder_phase => return Err(error),
            lease => lease.map_err(ImportErrorCode::from),
        };
        let ensured = async {
            let target_folder_id = match batch.target {
                ImportTarget::Root => None,
                ImportTarget::Existing { folder_id } => {
                    self.validate_folder(team, Some(folder_id)).await?;
                    Some(folder_id)
                }
                ImportTarget::New { name } => {
                    let id = derive_v7(import_id, "target", "");
                    self.repository
                        .ensure_folder(team, id, &Self::folder_name(name)?, None)
                        .await?;
                    Some(id)
                }
            };
            for folder in &batch.folders {
                let parent = folder
                    .parent_key
                    .as_ref()
                    .and_then(|key| folders.get(key))
                    .copied()
                    .or(target_folder_id);
                self.repository
                    .ensure_folder(team, folders[&folder.key], &names[&folder.key], parent)
                    .await?;
            }
            Ok::<_, Error>(target_folder_id)
        }
        .await;
        let target_folder_id = match ensured {
            Ok(id) => id,
            Err(error) => {
                if let Ok(lease) = lease {
                    lease.release().await?;
                }
                return Err(error);
            }
        };
        let mut result = ImportBatchResult {
            target_folder_id,
            folders: batch
                .folders
                .into_iter()
                .map(|folder| ImportFolderResult {
                    folder_id: folders[&folder.key],
                    key: folder.key,
                })
                .collect(),
            items: Vec::with_capacity(batch.items.len()),
        };
        let mut counts = ImportCounts {
            created: 0,
            already_present: 0,
            failed: 0,
            folders: folder_count,
        };
        let private = batch.private;
        let mut items = stream::iter(batch.items.into_iter().enumerate())
            .map(|(index, item)| {
                let id = ItemId(derive_v7(import_id, "item", item.source_key.as_ref()));
                let lease = &lease;
                let folders = &folders;
                let span = tracing::info_span!("passwords.import.item", item_id = %id.0,
                    outcome = tracing::field::Empty, error_code = tracing::field::Empty,
                    otel.status_code = tracing::field::Empty);
                async move {
                    let mut item_id = None;
                    let imported = match lease {
                        Err(error) => Err(*error),
                        Ok(lock) => async {
                            // Recheck current human membership for every item under the shared lease.
                            self.membership(actor, team).await?;
                            let folder_id = match &item.folder_key {
                                Some(key) => Some(*folders.get(key).ok_or(Error::Invalid)?),
                                None => target_folder_id,
                            };
                            let created = self
                                .create_under_lease(
                                    actor,
                                    team,
                                    WriteItem {
                                        operation_id: id.0,
                                        name: item.name,
                                        kind: item.kind,
                                        url: item.url,
                                        folder_id,
                                        favorite: item.favorite,
                                        private,
                                        expected_version: None,
                                        values: item.values,
                                    },
                                    lock.as_ref(),
                                )
                                .await;
                            let (_, created) = match created {
                                // A folder deleted since this batch ensured it: the next
                                // batch, or a retry, ensures it again.
                                Err(Error::Invalid)
                                    if folder_id.is_some()
                                        && self.validate_folder(team, folder_id).await.is_err() =>
                                {
                                    return Err(Error::FolderMissing);
                                }
                                result => result?,
                            };
                            item_id = Some(id);
                            if let Some(seed) = item.totp {
                                self.configure_totp_under_lease(
                                    actor,
                                    team,
                                    id,
                                    Some(seed),
                                    true,
                                    lock.as_ref(),
                                )
                                .await?;
                            }
                            Ok::<bool, Error>(created)
                        }
                        .await
                        .map_err(ImportErrorCode::from),
                    };
                    let (outcome, error_code) = match imported {
                        Ok(true) => (ImportOutcome::Created, None),
                        Ok(false) => (ImportOutcome::AlreadyPresent, None),
                        Err(error) => (ImportOutcome::Failed, Some(error)),
                    };
                    tracing::Span::current().record(
                        "outcome",
                        match outcome {
                            ImportOutcome::Created => "created",
                            ImportOutcome::AlreadyPresent => "already_present",
                            ImportOutcome::Failed => "failed",
                        },
                    );
                    if let Some(error) = error_code {
                        tracing::Span::current().record("error_code", tracing::field::debug(error));
                        tracing::Span::current().record("otel.status_code", "ERROR");
                    }
                    (
                        index,
                        ImportItemResult {
                            source_key: item.source_key,
                            outcome,
                            error_code,
                            item_id,
                        },
                    )
                }
                .instrument(span)
            })
            .buffer_unordered(concurrency.get())
            .collect::<Vec<_>>()
            .await;
        // Completion order is deliberately independent of the response contract.
        items.sort_unstable_by_key(|(index, _)| *index);
        for (_, item) in items {
            match item.outcome {
                ImportOutcome::Created => counts.created += 1,
                ImportOutcome::AlreadyPresent => counts.already_present += 1,
                ImportOutcome::Failed => counts.failed += 1,
            }
            result.items.push(item);
        }
        if let Ok(lease) = lease {
            lease.release().await?;
        }
        let span = tracing::Span::current();
        span.record("created", i64::from(counts.created));
        span.record("already_present", i64::from(counts.already_present));
        span.record("failed", i64::from(counts.failed));
        // The team FK cascades concurrent deletion. Audit failure must not hide item outcomes.
        let audited = self
            .repository
            .audit_import(team, import_id, actor, batch.format, counts)
            .await;
        span.record("audit_failed", audited.is_err());
        Ok(result)
    }
}

#[cfg(test)]
mod test;
