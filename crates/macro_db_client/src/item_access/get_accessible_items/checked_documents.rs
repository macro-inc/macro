use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, LazyLock, Mutex, PoisonError},
    time::{Duration, Instant},
};

use cached::{Cached, SizedCache};
use single_flight::DatabaseKey;
use sqlx::PgConnection;
use uuid::Uuid;

/// How long a caller's lookups reuse what an earlier one found about a granted
/// document: that it exists, and whether the caller owns it. Grants and Trash
/// state are read on every lookup, so a share that is revoked or added, a
/// document moved to or restored from the Trash, and a purge (which removes
/// the grants) count at once. Only a document given to another owner counts
/// once this has passed.
const CHECKS_KEPT_FOR: Duration = Duration::from_secs(600);

/// Callers whose checks a process keeps, the least recently used dropped first.
const CALLERS_KEPT: usize = 256;

/// What a lookup found about one granted document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Found {
    Owned,
    NotOwned,
    /// No longer in the table.
    Missing,
}

struct Checks {
    checked_at: Instant,
    found: HashMap<Uuid, Found>,
}

type CheckKey = (DatabaseKey, String);

/// Behind a pointer, as the lookup cache keeps its lists: one lock serves every
/// caller, so it is held to clone or swap a pointer, never to copy a map.
static KEPT: LazyLock<Mutex<SizedCache<CheckKey, Arc<Checks>>>> =
    LazyLock::new(|| Mutex::new(SizedCache::with_size(CALLERS_KEPT)));

/// What a lookup read and reused, recorded on its span.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct CheckCounts {
    pub(super) checked: usize,
    pub(super) reused: usize,
}

impl CheckCounts {
    /// `hit` when no granted document needed reading, `miss` when none of
    /// them had been checked, `partial` otherwise.
    pub(super) fn outcome(&self) -> &'static str {
        match (self.checked, self.reused) {
            (0, _) => "hit",
            (_, 0) => "miss",
            _ => "partial",
        }
    }
}

/// The ids among `granted` that are documents the caller can open: not in the
/// Trash, and not their own when `exclude_owned`.
///
/// Finding a granted document's owner costs one random read of `Document` when
/// its pages are not cached, and for callers holding thousands of grants those
/// pages are cold again a few minutes after their last search. So owners are
/// read only for the ids this caller's lookups have not checked within
/// `CHECKS_KEPT_FOR`, and the Trash state of every granted document from
/// `idx_document_trashed_id_owner`, which holds only trashed rows and stays
/// cached.
pub(super) async fn accessible_document_ids(
    connection: &mut PgConnection,
    database: DatabaseKey,
    user_id: &str,
    mut granted: Vec<Uuid>,
    exclude_owned: bool,
) -> sqlx::Result<(Vec<String>, CheckCounts)> {
    granted.sort_unstable();
    granted.dedup();

    let key = (database, user_id.to_string());
    let earlier = kept_checks(&key);
    let unchecked: Vec<Uuid> = granted
        .iter()
        .filter(|id| {
            earlier
                .as_ref()
                .is_none_or(|checks| !checks.found.contains_key(id))
        })
        .copied()
        .collect();
    let counts = CheckCounts {
        checked: unchecked.len(),
        reused: granted.len() - unchecked.len(),
    };

    let checks = if unchecked.is_empty() {
        earlier.unwrap_or_else(|| {
            Arc::new(Checks {
                checked_at: Instant::now(),
                found: HashMap::new(),
            })
        })
    } else {
        let checked_at = earlier
            .as_ref()
            .map_or_else(Instant::now, |checks| checks.checked_at);
        let owners = document_owners(connection, &unchecked).await?;

        let found = granted
            .iter()
            .map(|id| {
                let earlier_found = earlier
                    .as_ref()
                    .and_then(|checks| checks.found.get(id).copied());
                let found = earlier_found.unwrap_or_else(|| match owners.get(id) {
                    Some(owner) if owner == user_id => Found::Owned,
                    Some(_) => Found::NotOwned,
                    None => Found::Missing,
                });
                (*id, found)
            })
            .collect();
        let checks = Arc::new(Checks { checked_at, found });
        keep_checks(key, Arc::clone(&checks));
        checks
    };

    let listed: Vec<Uuid> = granted
        .into_iter()
        .filter(|id| match checks.found.get(id) {
            Some(Found::NotOwned) => true,
            Some(Found::Owned) => !exclude_owned,
            Some(Found::Missing) | None => false,
        })
        .collect();
    let trashed = trashed_documents(connection, &listed).await?;
    let ids = listed
        .iter()
        .filter(|id| !trashed.contains(id))
        .map(Uuid::to_string)
        .collect();

    Ok((ids, counts))
}

fn kept_checks(key: &CheckKey) -> Option<Arc<Checks>> {
    let mut kept = KEPT.lock().unwrap_or_else(PoisonError::into_inner);
    let checks = kept.cache_get(key).map(Arc::clone)?;

    (checks.checked_at.elapsed() < CHECKS_KEPT_FOR).then_some(checks)
}

fn keep_checks(key: CheckKey, checks: Arc<Checks>) {
    let mut kept = KEPT.lock().unwrap_or_else(PoisonError::into_inner);
    kept.cache_set(key, checks);
}

struct DocumentOwner {
    id: Uuid,
    owner: String,
}

/// The owner of each document among `ids` still in the table, in the Trash or
/// not.
///
/// Unlike the grant reads, these statements may run as cached prepared
/// statements: their fences leave one plan, a lookup per id, generic or not.
async fn document_owners(
    connection: &mut PgConnection,
    ids: &[Uuid],
) -> sqlx::Result<HashMap<Uuid, String>> {
    let documents = sqlx::query_file_as!(
        DocumentOwner,
        "src/item_access/get_accessible_items/documents_by_id.sql",
        ids
    )
    .fetch_all(connection)
    .await?;

    Ok(documents
        .into_iter()
        .map(|document| (document.id, document.owner))
        .collect())
}

/// The ids among `ids` whose document is in the Trash.
async fn trashed_documents(
    connection: &mut PgConnection,
    ids: &[Uuid],
) -> sqlx::Result<HashSet<Uuid>> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }

    let trashed = sqlx::query_file_scalar!(
        "src/item_access/get_accessible_items/trashed_by_id.sql",
        ids
    )
    .fetch_all(connection)
    .await?;

    Ok(trashed.into_iter().collect())
}
