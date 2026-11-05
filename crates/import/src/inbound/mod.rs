//! Inbound adapters: the AI toolset and the HTTP router.

use std::time::Duration;

use import_notion::domain::model::{ImportScope, NotionId};

pub mod axum_router;
pub mod toolset;

/// How long planning a workspace import waits before handing back a plan
/// that is still being made: long enough for a tiny workspace to come back
/// ready, short enough that the review is presented while it fills in.
const PLAN_WAIT: Duration = Duration::from_secs(5);

/// The Notion scope `roots` (page or database URLs or ids) name: everything
/// when none is given. Errors with the first root that is not a Notion id.
fn notion_scope(roots: &[String]) -> Result<ImportScope, &str> {
    let roots = roots
        .iter()
        .map(|root| root.trim())
        .filter(|root| !root.is_empty())
        .collect::<Vec<_>>();
    if roots.is_empty() {
        return Ok(ImportScope::Everything);
    }

    let ids = roots
        .into_iter()
        .map(|root| NotionId::parse(root).ok_or(root))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ImportScope::Roots { ids })
}
