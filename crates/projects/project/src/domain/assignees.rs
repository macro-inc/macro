//! Initiative-owned policy for assignee access grants.

use super::{models::InitiativeError, ports::InitiativeRepo, service::initiative_id_from_receipt};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;

/// Minimal owning service for property compositions that grant assignee access.
pub struct InitiativeAssignees<R>(R);

impl<R> std::fmt::Debug for InitiativeAssignees<R> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("InitiativeAssignees")
    }
}

impl<R: InitiativeRepo> InitiativeAssignees<R> {
    /// Compose with the initiative repository at the application root.
    pub fn new(repo: R) -> Self {
        Self(repo)
    }

    /// Add grants and non-owner collaborators on project and description. Existing
    /// collaborators remain, and clearing an assignee does not revoke their access.
    pub async fn grant(
        &self,
        receipt: &EntityAccessReceipt<EditAccessLevel>,
        users: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), InitiativeError> {
        grant(&self.0, receipt, users).await
    }
}

pub(super) async fn grant<R: InitiativeRepo>(
    repo: &R,
    receipt: &EntityAccessReceipt<EditAccessLevel>,
    users: Vec<MacroUserIdStr<'static>>,
) -> Result<(), InitiativeError> {
    let id = initiative_id_from_receipt(receipt)?;
    let mut seen = HashSet::new();
    let users = users
        .into_iter()
        .filter(|id| seen.insert(id.clone()))
        .collect();
    repo.grant_assignees(id, users).await.map_err(Into::into)
}
