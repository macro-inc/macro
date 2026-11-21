//! Operator route that files a team's manual contacts under the companies
//! for their email domains. Internal callers only; nothing calls it on its
//! own.

use axum::{
    Json,
    extract::{Path, State},
};
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::{
    contact_filing::{ContactFilingBatch, ContactFilingService, MAX_FILING_BATCH},
    model::CrmError,
};

use super::CrmRouterState;

/// Path of the route under the internal CRM router.
pub(super) const ROUTE: &str = "/teams/{team_id}/file-unfiled-contacts";

/// One batch to run.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileUnfiledContactsRequest {
    /// Report what the batch would do without writing. Defaults to true, so
    /// a write is always asked for by name.
    #[serde(default = "dry_run_by_default")]
    pub dry_run: bool,
    /// The `nextAfter` of the previous batch; omit for the first. It is a
    /// contact address, so it travels in the body, never the path.
    #[serde(default)]
    pub after: Option<String>,
    /// Contacts to examine, at most [`MAX_FILING_BATCH`].
    #[serde(default = "default_limit")]
    pub limit: u16,
}

fn dry_run_by_default() -> bool {
    true
}

fn default_limit() -> u16 {
    100
}

/// What the batch did, or would do in a dry run.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUnfiledContactsResponse {
    /// Whether nothing was written.
    pub dry_run: bool,
    /// Contacts the batch looked at.
    pub examined: u32,
    /// Contacts that joined a company.
    pub filed: u32,
    /// Companies created for them.
    pub companies_created: u32,
    /// Contacts left without a company, by reason.
    pub skipped: SkippedContacts,
    /// Contacts whose filing failed; a later run retries them.
    pub failed: u32,
    /// Pass as `after` for the next batch; absent once the team is done.
    pub next_after: Option<String>,
}

/// Why contacts were left without a company.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedContacts {
    /// Email sync filed the contact without a company.
    pub not_manual: u32,
    /// The contact is archived.
    pub archived: u32,
    /// The address is at a personal or generic provider.
    pub provider_domain: u32,
    /// The team keeps the domain out of email sync.
    pub blocked_domain: u32,
    /// The domain's company is hidden.
    pub hidden_company: u32,
    /// Another contact of the team holds one of the contact's addresses.
    pub duplicate_address: u32,
    /// The contact changed since the batch listed it.
    pub changed: u32,
}

impl FileUnfiledContactsResponse {
    fn new(dry_run: bool, batch: ContactFilingBatch) -> Self {
        Self {
            dry_run,
            examined: batch.examined,
            filed: batch.filed,
            companies_created: batch.companies_created,
            skipped: SkippedContacts {
                not_manual: batch.skipped_not_manual,
                archived: batch.skipped_archived,
                provider_domain: batch.skipped_provider_domain,
                blocked_domain: batch.skipped_blocked_domain,
                hidden_company: batch.skipped_hidden_company,
                duplicate_address: batch.skipped_duplicate_address,
                changed: batch.skipped_changed,
            },
            failed: batch.failed,
            next_after: batch.next_after,
        }
    }
}

/// `POST /internal/crm/teams/{team_id}/file-unfiled-contacts`.
///
/// Files one batch of the team's manual contacts that have no company and
/// returns the counts. Repeat with `after` set to the returned `nextAfter`
/// until it is absent; a run is complete only then. Running it again is
/// safe, and retries the contacts counted as `failed` (a lock that stayed
/// busy for five seconds is one).
#[tracing::instrument(skip_all, fields(%team_id, dry_run = request.dry_run), err)]
pub async fn handler<C, St, Eas, Auth>(
    _auth: MacroAuthorizationExtractor<Auth, InternalOnly>,
    State(state): State<CrmRouterState<C, St, Eas, Auth>>,
    Path(team_id): Path<Uuid>,
    Json(request): Json<FileUnfiledContactsRequest>,
) -> Result<Json<FileUnfiledContactsResponse>, CrmError>
where
    C: ContactFilingService,
    Auth: MacroAuthorizationService,
{
    if request.limit == 0 || request.limit > MAX_FILING_BATCH {
        return Err(CrmError::InvalidRequest(format!(
            "limit must be between 1 and {MAX_FILING_BATCH}"
        )));
    }

    let batch = state
        .service
        .file_unfiled_contacts(
            team_id,
            request.after.as_deref(),
            request.limit,
            request.dry_run,
        )
        .await?;
    Ok(Json(FileUnfiledContactsResponse::new(
        request.dry_run,
        batch,
    )))
}
