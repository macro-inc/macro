//! Mirroring Notion's structure as folders under one "Notion" folder.
//!
//! Only branches that lead to imported pages are mirrored: a page with
//! imported descendants becomes a folder named after it (its own document
//! goes inside), a database becomes a folder holding its imported rows, a
//! page inside a block (a column, a toggle) belongs to that block's page,
//! and ancestors the connection cannot read are skipped. Paths stop at
//! [`MAX_FOLDER_DEPTH`] levels below the root.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::document_name;
use crate::domain::models::{ImportSource, NotionId, NotionParent};
use crate::domain::ports::{EntityCreator, ImportRepo, NotionSession};

#[cfg(test)]
mod test;

/// The root folder every Notion import lands under.
pub(crate) const ROOT_FOLDER_NAME: &str = "Notion";
/// The folder-mapping key of the root folder.
const ROOT_FOLDER_KEY: &str = "";
/// Folder levels below the root; deeper chains attach at the last level.
pub(crate) const MAX_FOLDER_DEPTH: usize = 4;
/// Block-to-block hops followed to find a page (columns nest a few deep).
const MAX_BLOCK_HOPS: usize = 16;
/// Containers resolved for one batch, bounding pathological workspaces.
const MAX_CONTAINERS: usize = 200;

/// A readable page or database above (or among) the imported pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Ancestor {
    /// Folder name: emoji icon and title, like document names.
    pub name: String,
    /// The nearest readable page or database above it, if any.
    pub parent: Option<NotionId>,
}

/// The readable containers above a batch's pages, keyed by id. Batch pages
/// are included, since a page with imported descendants is a folder too.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub(crate) struct Ancestry {
    pub nodes: HashMap<NotionId, Ancestor>,
}

/// One folder of a placement path.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct FolderSpec {
    /// The Notion page or database it stands for.
    pub key: NotionId,
    /// Its name.
    pub name: String,
}

/// A page to place: its id, document name, and Notion parent.
#[derive(Debug, Clone)]
pub(crate) struct PlacedPage {
    pub id: NotionId,
    pub name: String,
    pub parent: NotionParent,
}

/// The folder path (top first, below the root) each page's document goes
/// into. Pure: the same pages and ancestry always give the same plan.
pub(crate) fn plan_folders(
    pages: &[NotionId],
    ancestry: &Ancestry,
) -> HashMap<NotionId, Vec<FolderSpec>> {
    let chain = |page: &NotionId| -> Vec<NotionId> {
        let mut chain = Vec::new();
        let mut seen = HashSet::from([page.clone()]);
        let mut current = ancestry
            .nodes
            .get(page)
            .and_then(|node| node.parent.clone());
        while let Some(id) = current {
            if !seen.insert(id.clone()) {
                break;
            }
            let Some(node) = ancestry.nodes.get(&id) else {
                break;
            };
            chain.push(id);
            current = node.parent.clone();
        }
        chain
    };
    let chains: HashMap<&NotionId, Vec<NotionId>> =
        pages.iter().map(|page| (page, chain(page))).collect();
    let has_imported_descendants: HashSet<&NotionId> = chains.values().flatten().collect();

    pages
        .iter()
        .map(|page| {
            let mut path: Vec<NotionId> = chains[page].iter().rev().cloned().collect();
            if has_imported_descendants.contains(page) {
                path.push(page.clone());
            }
            path.truncate(MAX_FOLDER_DEPTH);
            let specs = path
                .into_iter()
                .map(|key| FolderSpec {
                    name: ancestry.nodes[&key].name.clone(),
                    key,
                })
                .collect();
            (page.clone(), specs)
        })
        .collect()
}

/// Reads the containers above a batch's pages, each at most once.
struct Resolver<'a, S> {
    session: &'a S,
    /// Known containers: name and Notion parent.
    known: HashMap<NotionId, (String, NotionParent)>,
    unreadable: HashSet<NotionId>,
    block_parents: HashMap<NotionId, Option<NotionParent>>,
}

impl<S: NotionSession> Resolver<'_, S> {
    async fn page(&mut self, id: &NotionId) -> bool {
        if self.known.contains_key(id) {
            return true;
        }
        if self.unreadable.contains(id) {
            return false;
        }
        match self.session.page(id).await {
            Ok(page) => {
                let name = document_name(&page.title, page.icon_emoji.as_deref());
                self.known.insert(id.clone(), (name, page.parent));
                true
            }
            Err(error) => {
                tracing::debug!(page = %id, error = %error, "Notion ancestor not readable");
                self.unreadable.insert(id.clone());
                false
            }
        }
    }

    async fn database(&mut self, id: &NotionId) -> bool {
        if self.known.contains_key(id) {
            return true;
        }
        if self.unreadable.contains(id) {
            return false;
        }
        match self.session.database(id).await {
            Ok(database) => {
                let name = document_name(&database.title, database.icon_emoji.as_deref());
                self.known.insert(id.clone(), (name, database.parent));
                true
            }
            Err(error) => {
                tracing::debug!(database = %id, error = %error, "Notion database not readable");
                self.unreadable.insert(id.clone());
                false
            }
        }
    }

    /// The nearest readable page or database a parent reference leads to.
    async fn container_of(&mut self, parent: &NotionParent) -> Option<NotionId> {
        let mut current = parent.clone();
        for _ in 0..MAX_BLOCK_HOPS {
            match current {
                NotionParent::Page(raw) => {
                    let id = NotionId::parse(&raw)?;
                    return self.page(&id).await.then_some(id);
                }
                NotionParent::Database(raw) => {
                    let id = NotionId::parse(&raw)?;
                    return self.database(&id).await.then_some(id);
                }
                NotionParent::DataSource(raw) => {
                    let id = NotionId::parse(&raw)?;
                    let database = self.session.data_source_database(&id).await.ok()?;
                    current = NotionParent::Database(database.as_str().to_string());
                }
                NotionParent::Block(raw) => {
                    let id = NotionId::parse(&raw)?;
                    let parent = match self.block_parents.get(&id) {
                        Some(parent) => parent.clone(),
                        None => {
                            let parent = self.session.block_parent(&id).await.ok();
                            self.block_parents.insert(id, parent.clone());
                            parent
                        }
                    };
                    current = parent?;
                }
                NotionParent::Workspace | NotionParent::Unknown => return None,
            }
        }
        None
    }
}

/// Resolve the readable containers above `pages`, reading each ancestor
/// once. Unreadable ancestors end a chain; the page attaches below them.
pub(crate) async fn resolve_ancestry(
    session: &impl NotionSession,
    pages: &[PlacedPage],
) -> Ancestry {
    let mut resolver = Resolver {
        session,
        known: pages
            .iter()
            .map(|page| (page.id.clone(), (page.name.clone(), page.parent.clone())))
            .collect(),
        unreadable: HashSet::new(),
        block_parents: HashMap::new(),
    };
    let mut ancestry = Ancestry::default();
    let mut queue: Vec<NotionId> = pages.iter().map(|page| page.id.clone()).collect();
    while let Some(id) = queue.pop() {
        if ancestry.nodes.contains_key(&id) || ancestry.nodes.len() >= MAX_CONTAINERS {
            continue;
        }
        let Some((name, parent)) = resolver.known.get(&id).cloned() else {
            continue;
        };
        let parent = resolver.container_of(&parent).await;
        if let Some(parent) = &parent
            && !ancestry.nodes.contains_key(parent)
        {
            queue.push(parent.clone());
        }
        ancestry.nodes.insert(id, Ancestor { name, parent });
    }
    ancestry
}

/// Serializes folder creation per user, so concurrent page imports in one
/// batch never create the same folder twice.
#[derive(Default)]
pub(crate) struct FolderLocks(Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>);

impl FolderLocks {
    fn lock_for(&self, user: &MacroUserIdStr<'static>) -> Arc<tokio::sync::Mutex<()>> {
        let mut locks = self.0.lock().unwrap();
        locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        locks.entry(user.as_ref().to_string()).or_default().clone()
    }
}

/// The folder a page's document goes into: the "Notion" root, then the
/// planned path, each created on first use and reused after (the mapping
/// survives re-runs; a deleted folder is recreated).
pub(crate) async fn ensure_folder_path(
    repo: &impl ImportRepo,
    creator: &impl EntityCreator,
    locks: &FolderLocks,
    user: &MacroUserIdStr<'static>,
    path: &[FolderSpec],
) -> anyhow::Result<Uuid> {
    let lock = locks.lock_for(user);
    let _guard = lock.lock().await;
    let mut folder =
        ensure_folder(repo, creator, user, ROOT_FOLDER_KEY, ROOT_FOLDER_NAME, None).await?;
    for spec in path {
        folder = ensure_folder(
            repo,
            creator,
            user,
            spec.key.as_str(),
            &spec.name,
            Some(folder),
        )
        .await?;
    }
    Ok(folder)
}

async fn ensure_folder(
    repo: &impl ImportRepo,
    creator: &impl EntityCreator,
    user: &MacroUserIdStr<'static>,
    key: &str,
    name: &str,
    parent: Option<Uuid>,
) -> anyhow::Result<Uuid> {
    if let Some(existing) = repo.import_folder(user, ImportSource::Notion, key).await?
        && creator.folder_usable(user, existing).await?
    {
        return Ok(existing);
    }
    let created = creator.create_folder(user, name, parent).await?;
    repo.save_import_folder(user, ImportSource::Notion, key, created)
        .await?;
    Ok(created)
}
