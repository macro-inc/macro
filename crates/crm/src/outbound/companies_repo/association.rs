//! Resolve CRM records and activity scope to the records their items match.
//!
//! Record visibility mirrors viewer-scoped contact listing, including hidden
//! rows for admins and owners. Activity always excludes hidden companies and
//! contacts. Both require CRM-enabled teams and membership or a team receipt.

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
            CrmAssociation::Activity => Ok(None),
            CrmAssociation::Contact(contact_id) => Ok(self
                .contact_visible(scope, contact_id)
                .await?
                .then(|| CrmRecordAssociation::contact(contact_id))),
        }
    }

    #[tracing::instrument(name = "crm.activity_scope", skip_all, err)]
    pub(super) async fn query_activity(
        &self,
        scope: CrmContactListScope<'_>,
    ) -> Result<CrmRecordAssociation, CrmError> {
        let (viewer, team_id) = match scope {
            CrmContactListScope::Viewer(user_id) => (Some(user_id), None),
            CrmContactListScope::Team { team_id, .. } => (None, Some(team_id)),
        };
        let rows = sqlx::query!(
            r#"
            SELECT co.id AS "company_id!", ct.id AS "contact_id?",
                   LOWER(BTRIM(d.domain)) AS "domain?", LOWER(BTRIM(ct.email)) AS "email?"
            FROM crm_companies co
            JOIN team_crm_settings tcs ON tcs.team_id = co.team_id AND tcs.crm_enabled
            LEFT JOIN team_user tu ON tu.team_id = co.team_id AND tu.user_id = $1
            LEFT JOIN crm_contacts ct ON ct.company_id = co.id AND NOT ct.hidden
            LEFT JOIN crm_domains d ON d.company_id = co.id
            WHERE NOT co.hidden
              AND (($1::text IS NOT NULL AND tu.user_id IS NOT NULL)
                   OR ($2::uuid IS NOT NULL AND co.team_id = $2))
            "#,
            viewer,
            team_id,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        let mut company_ids = std::collections::BTreeSet::new();
        let mut contact_ids = std::collections::BTreeSet::new();
        let mut domains = std::collections::BTreeSet::new();
        let mut addresses = std::collections::BTreeSet::new();
        for row in rows {
            company_ids.insert(row.company_id);
            contact_ids.extend(row.contact_id);
            domains.extend(row.domain);
            addresses.extend(row.email);
        }
        Ok(CrmRecordAssociation {
            company_ids: company_ids.into_iter().collect(),
            contact_ids: contact_ids.into_iter().collect(),
            domains: domains.into_iter().collect(),
            addresses: addresses.into_iter().collect(),
        })
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
