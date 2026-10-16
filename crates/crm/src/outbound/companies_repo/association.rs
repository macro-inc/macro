//! Resolve a CRM record to the records its associated items match.
//!
//! Visibility mirrors the viewer-scoped contact listing: the owning team must
//! have CRM enabled, a viewer must belong to it, and hidden companies and
//! contacts are visible only to its admins and owners (or a team-scoped bot
//! receipt that permits hidden rows).

use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::{
    association::{CrmAssociation, CrmRecordAssociation},
    contact_listing::CrmContactListScope,
    model::CrmError,
};

impl CompaniesRepositoryImpl {
    pub(super) async fn query_association(
        &self,
        scope: CrmContactListScope<'_>,
        record: CrmAssociation,
    ) -> Result<Option<CrmRecordAssociation>, CrmError> {
        match record {
            CrmAssociation::Company(company_id) => {
                let rows = self.company_contacts(scope, company_id).await?;
                // One row per visible contact, or a single NULL-contact row
                // for a visible company without any; no rows means the
                // company itself is not visible.
                if rows.is_empty() {
                    return Ok(None);
                }
                Ok(Some(CrmRecordAssociation::company(
                    company_id,
                    rows.into_iter().flatten().collect(),
                )))
            }
            CrmAssociation::Contact(contact_id) => Ok(self
                .contact_visible(scope, contact_id)
                .await?
                .then(|| CrmRecordAssociation::contact(contact_id))),
        }
    }

    async fn company_contacts(
        &self,
        scope: CrmContactListScope<'_>,
        company_id: Uuid,
    ) -> Result<Vec<Option<Uuid>>, CrmError> {
        let rows = match scope {
            CrmContactListScope::Viewer(user_id) => {
                sqlx::query_scalar!(
                    r#"
                    SELECT ct.id AS "contact_id?"
                    FROM crm_companies co
                    JOIN team_crm_settings tcs ON tcs.team_id = co.team_id AND tcs.crm_enabled
                    JOIN team_user tu ON tu.team_id = co.team_id AND tu.user_id = $1
                    LEFT JOIN crm_contacts ct
                        ON ct.company_id = co.id
                       AND (NOT ct.hidden OR tu.team_role <> 'member')
                    WHERE co.id = $2
                      AND (NOT co.hidden OR tu.team_role <> 'member')
                    ORDER BY ct.id
                    "#,
                    user_id,
                    company_id,
                )
                .fetch_all(&self.pool)
                .await
            }
            CrmContactListScope::Team {
                team_id,
                include_hidden,
            } => {
                sqlx::query_scalar!(
                    r#"
                    SELECT ct.id AS "contact_id?"
                    FROM crm_companies co
                    JOIN team_crm_settings tcs ON tcs.team_id = co.team_id AND tcs.crm_enabled
                    LEFT JOIN crm_contacts ct
                        ON ct.company_id = co.id AND (NOT ct.hidden OR $3)
                    WHERE co.id = $1
                      AND co.team_id = $2
                      AND (NOT co.hidden OR $3)
                    ORDER BY ct.id
                    "#,
                    company_id,
                    team_id,
                    include_hidden,
                )
                .fetch_all(&self.pool)
                .await
            }
        };
        rows.map_err(|error| CrmError::StorageLayerError(error.into()))
    }

    async fn contact_visible(
        &self,
        scope: CrmContactListScope<'_>,
        contact_id: Uuid,
    ) -> Result<bool, CrmError> {
        let visible = match scope {
            CrmContactListScope::Viewer(user_id) => {
                sqlx::query_scalar!(
                    r#"
                    SELECT EXISTS (
                        SELECT 1
                        FROM crm_contacts ct
                        JOIN crm_companies co ON co.id = ct.company_id
                        JOIN team_crm_settings tcs ON tcs.team_id = co.team_id AND tcs.crm_enabled
                        JOIN team_user tu ON tu.team_id = co.team_id AND tu.user_id = $1
                        WHERE ct.id = $2
                          AND (NOT (ct.hidden OR co.hidden) OR tu.team_role <> 'member')
                    ) AS "visible!"
                    "#,
                    user_id,
                    contact_id,
                )
                .fetch_one(&self.pool)
                .await
            }
            CrmContactListScope::Team {
                team_id,
                include_hidden,
            } => {
                sqlx::query_scalar!(
                    r#"
                    SELECT EXISTS (
                        SELECT 1
                        FROM crm_contacts ct
                        JOIN crm_companies co ON co.id = ct.company_id
                        JOIN team_crm_settings tcs ON tcs.team_id = co.team_id AND tcs.crm_enabled
                        WHERE ct.id = $1
                          AND co.team_id = $2
                          AND (NOT (ct.hidden OR co.hidden) OR $3)
                    ) AS "visible!"
                    "#,
                    contact_id,
                    team_id,
                    include_hidden,
                )
                .fetch_one(&self.pool)
                .await
            }
        };
        visible.map_err(|error| CrmError::StorageLayerError(error.into()))
    }
}
