//! Which forms a user reaches through grants, asked of the owning
//! `entity_access` domain, whose source-id and highest-grant rules are not
//! copied here.

use std::sync::Arc;

use entity_access::domain::models::{AccessError, AccessLevel};
use entity_access::domain::ports::AccessibleForms;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::FormId;
use crate::domain::ports::FormAccessDirectory;

/// The directory's error: whatever `entity_access` reports.
#[derive(Debug, thiserror::Error)]
#[error("entity access: {0}")]
pub struct EntityAccessFormDirectoryError(#[from] AccessError);

/// [`FormAccessDirectory`] over the entity access service.
#[derive(Debug, Clone)]
pub struct EntityAccessFormDirectory<Access> {
    access: Arc<Access>,
}

impl<Access> EntityAccessFormDirectory<Access> {
    /// Wrap the host's entity access service.
    pub fn new(access: Arc<Access>) -> Self {
        Self { access }
    }
}

impl<Access> FormAccessDirectory for EntityAccessFormDirectory<Access>
where
    Access: AccessibleForms,
{
    type Error = EntityAccessFormDirectoryError;

    #[tracing::instrument(err, skip(self, user))]
    async fn accessible_forms(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Vec<(FormId, AccessLevel)>, Self::Error> {
        Ok(self
            .access
            .accessible_forms(user)
            .await?
            .into_iter()
            .map(|(form, grant)| (FormId::from_uuid(form), grant))
            .collect())
    }
}
