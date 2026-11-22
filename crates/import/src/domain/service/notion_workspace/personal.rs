//! Owner-only destinations for personal copies whose source folder is shared.

use super::super::{ImportServiceImpl, PersonalMirrorLocks};
use super::write::{Progress, WriteItem};
use crate::domain::models::{WrittenKind, WrittenObject};
use crate::domain::ports::{
    CanonicalImportRepo, EntityCreator, ImportRepo, ImportVisibility, NotionPlanRepo,
    NotionRunRepo, Result, SlackWorkspaceSource, WorkspaceWriter, WrittenObjects,
};
use connectors::McpConnectionsService;
use import_notion::domain::ports::NotionConnections;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

// Separate roles retain the existing ledger kind so older readers can parse them.
const SHARED_BRANCH: &str = "shared";
const PERSONAL_MIRROR: &str = "personal_mirror";

/// A structural folder's reviewed visibility and current destination context.
pub(super) struct FolderPlan<'a> {
    pub parent: Uuid,
    pub path: &'a [String],
    pub visibility: ImportVisibility,
    pub team: Option<Uuid>,
}

impl PersonalMirrorLocks {
    async fn for_user(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> std::sync::Arc<tokio::sync::Mutex<()>> {
        let mut users = self.users.lock().await;
        users.retain(|_, lock| lock.strong_count() != 0);
        if let Some(lock) = users.get(user.as_ref()).and_then(std::sync::Weak::upgrade) {
            return lock;
        }
        let lock = std::sync::Arc::new(tokio::sync::Mutex::new(()));
        users.insert(user.as_ref().to_string(), std::sync::Arc::downgrade(&lock));
        lock
    }
}

impl<R, S, C, W, N> ImportServiceImpl<R, S, C, W, N>
where
    R: ImportRepo + CanonicalImportRepo + NotionPlanRepo + NotionRunRepo + WrittenObjects + Clone,
    S: McpConnectionsService,
    C: EntityCreator + WorkspaceWriter,
    W: SlackWorkspaceSource,
    N: NotionConnections,
{
    /// Resolve page folders without granting access to earlier personal contents.
    #[tracing::instrument(skip_all, fields(import_id = %item.import_id), err)]
    pub(super) async fn planned_page_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &WriteItem,
        plan: &FolderPlan<'_>,
        progress: &Progress<'_, R>,
    ) -> Result<Uuid> {
        let previous = progress.get(WrittenKind::Folder);
        let shared_branch = progress.get_for(WrittenKind::Folder, SHARED_BRANCH);
        match plan.visibility {
            ImportVisibility::Personal => {
                if let Some(folder) = previous {
                    return Ok(folder);
                }
                let mirrored = self
                    .creator
                    .folder_has_explicit_grant(user, plan.parent)
                    .await?;
                let folder = if mirrored {
                    let folder = self.personal_mirror_folder(user, plan.path).await?;
                    self.repo
                        .record_personal_relocation(user, item.import_id, folder)
                        .await?;
                    progress
                        .record_all(vec![WrittenObject {
                            import_id: item.import_id,
                            kind: WrittenKind::Folder,
                            object: PERSONAL_MIRROR.into(),
                            macro_id: folder,
                        }])
                        .await?;
                    folder
                } else {
                    self.creator
                        .create_folder(user, &item.title, Some(plan.parent), plan.visibility)
                        .await?
                };
                if shared_branch.is_some() {
                    self.repo
                        .record_separate_folder(
                            user,
                            item.import_id,
                            folder,
                            crate::domain::ports::FolderSeparation::PersonalFromShared,
                        )
                        .await?;
                }
                progress.record(WrittenKind::Folder, folder).await?;
                Ok(folder)
            }
            ImportVisibility::Shared => {
                if let Some(folder) = shared_branch {
                    // Reuse existing grants, but preserve a user's removal of one.
                    if plan.team.is_none()
                        || self
                            .creator
                            .folder_has_team_edit_grant(user, folder)
                            .await?
                    {
                        return Ok(folder);
                    }
                } else if let Some(folder) = previous {
                    let mirror = progress.get_for(WrittenKind::Folder, PERSONAL_MIRROR)
                        == Some(folder)
                        || self.repo.personal_folder(user, plan.path).await? == Some(folder);
                    // A legacy branch is never promoted: a later grant removal
                    // must still cause a fresh folder instead of a re-grant.
                    if !mirror
                        && self
                            .creator
                            .folder_has_team_edit_grant(user, folder)
                            .await?
                    {
                        return Ok(folder);
                    }
                }
                let folder = self
                    .creator
                    .create_folder(user, &item.title, Some(plan.parent), plan.visibility)
                    .await?;
                if previous.is_some() || shared_branch.is_some() {
                    self.repo
                        .record_separate_folder(
                            user,
                            item.import_id,
                            folder,
                            if shared_branch.is_some() {
                                crate::domain::ports::FolderSeparation::SharedAfterGrantRemoval
                            } else {
                                crate::domain::ports::FolderSeparation::SharedFromPersonal
                            },
                        )
                        .await?;
                }
                self.repo
                    .set_shared_folder(user, item.import_id, folder)
                    .await?;
                if plan.team.is_some() {
                    self.creator
                        .share_with_team(user, crate::domain::ports::SharedEntity::Folder(folder))
                        .await?;
                }
                Ok(folder)
            }
        }
    }

    /// Resolve a source folder path inside the user's persistent personal mirror.
    /// Call while holding the user's Notion write lease. Shared ancestors are
    /// never changed; stale or subsequently shared mirror folders are replaced.
    #[tracing::instrument(skip_all, fields(path_depth = i64::try_from(path.len()).unwrap_or(i64::MAX)), err)]
    pub async fn personal_mirror_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        path: &[String],
    ) -> Result<Uuid> {
        let lock = self.mirror_locks.for_user(user).await;
        let _guard = lock.lock().await;
        let root = match self.repo.personal_root_folder(user).await? {
            Some(root)
                if self.creator.folder_exists(user, root).await?
                    && !self.creator.folder_has_explicit_grant(user, root).await? =>
            {
                root
            }
            _ => {
                let root = self
                    .creator
                    .create_folder(user, "Notion (personal)", None, ImportVisibility::Personal)
                    .await?;
                self.repo.set_personal_root_folder(user, root).await?;
                root
            }
        };
        let mut parent = root;
        let mut prefix = Vec::new();
        let mut replaced_ancestor = false;
        for name in path {
            prefix.push(name.clone());
            let recorded = if replaced_ancestor {
                None
            } else {
                self.repo.personal_folder(user, &prefix).await?
            };
            parent = match recorded {
                Some(folder)
                    if self.creator.folder_exists(user, folder).await?
                        && !self.creator.folder_has_explicit_grant(user, folder).await? =>
                {
                    folder
                }
                _ => {
                    replaced_ancestor = true;
                    let folder = self
                        .creator
                        .create_folder(user, name, Some(parent), ImportVisibility::Personal)
                        .await?;
                    self.repo.set_personal_folder(user, &prefix, folder).await?;
                    folder
                }
            };
        }
        Ok(parent)
    }

    /// Keep a personal item out of explicit grants on its proposed folder tree.
    /// Record a relocation so the import report explains its destination.
    #[tracing::instrument(skip_all, fields(import_id = %import_id, folder_id = %destination), err)]
    pub async fn personal_item_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        import_id: Uuid,
        destination: Uuid,
        path: &[String],
    ) -> Result<Uuid> {
        if !self
            .creator
            .folder_has_explicit_grant(user, destination)
            .await?
        {
            return Ok(destination);
        }
        let folder = self.personal_mirror_folder(user, path).await?;
        self.repo
            .record_personal_relocation(user, import_id, folder)
            .await?;
        Ok(folder)
    }
}
