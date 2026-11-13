//! Resolve CRM records and activity scope to the records their items match.
//!
//! Record visibility follows team membership and record visibility.
//! Activity excludes hidden records, including for admins. Email consent
//! and exclusions do not hide CRM records.

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
        // The read's cost follows the team's record count, so bound it.
        let mut transaction = self
            .pool
            .begin()
            .await
            .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *transaction)
            .await
            .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        // Every step is a probe by key, so the cost stays with the team's own
        // records whatever the planner knows about the tables. The teams are
        // collected into an array first, so every arm starts from its team
        // index. Each contact's addresses and each company's domains are read
        // behind an `OFFSET 0` fence: unfenced, the planner can hash the whole
        // address or domain table, which holds every team's rows. Contacts
        // without a company are narrowed to the team behind a fence too, so
        // the scan cannot start from every team's company-less contacts.
        // Domains and contacts are separate arms so neither is read once per
        // row of the other.
        let rows = sqlx::query!(
            r#"
            WITH scope AS (
                SELECT tu.team_id FROM team_user tu WHERE tu.user_id = $1
                UNION ALL
                SELECT $2::uuid
            )
            SELECT co.id AS "company_id?", NULL::uuid AS "contact_id?",
                   LOWER(BTRIM(d.domain)) AS "domain?", NULL::text AS "email?"
            FROM crm_companies co
            LEFT JOIN LATERAL (
                SELECT d.domain FROM crm_domains d WHERE d.company_id = co.id OFFSET 0
            ) d ON TRUE
            WHERE NOT co.hidden
              AND co.team_id = ANY(ARRAY(SELECT team_id FROM scope))
            UNION ALL
            -- Contacts under a visible company.
            SELECT NULL, ct.id, NULL, address.email
            FROM crm_companies co
            JOIN crm_contacts ct
                ON ct.company_id = co.id AND ct.team_id = co.team_id AND NOT ct.hidden
            LEFT JOIN LATERAL (
                SELECT ce.email FROM crm_contact_emails ce WHERE ce.contact_id = ct.id OFFSET 0
            ) address ON TRUE
            WHERE NOT co.hidden
              AND co.team_id = ANY(ARRAY(SELECT team_id FROM scope))
            UNION ALL
            -- Contacts without a company.
            SELECT NULL, ct.id, NULL, address.email
            FROM (
                SELECT ct.id, ct.company_id, ct.hidden
                FROM crm_contacts ct
                WHERE ct.team_id = ANY(ARRAY(SELECT team_id FROM scope))
                OFFSET 0
            ) ct
            LEFT JOIN LATERAL (
                SELECT ce.email FROM crm_contact_emails ce WHERE ce.contact_id = ct.id OFFSET 0
            ) address ON TRUE
            WHERE ct.company_id IS NULL
              AND NOT ct.hidden
            "#,
            viewer,
            team_id,
        )
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        transaction
            .commit()
            .await
            .map_err(|error| CrmError::StorageLayerError(error.into()))?;
        let mut company_ids = std::collections::BTreeSet::new();
        let mut contact_ids = std::collections::BTreeSet::new();
        let mut domains = std::collections::BTreeSet::new();
        let mut addresses = std::collections::BTreeSet::new();
        for row in rows {
            company_ids.extend(row.company_id);
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
                        LEFT JOIN crm_companies co ON co.id = ct.company_id
                        JOIN team_user tu ON tu.team_id = ct.team_id AND tu.user_id = $1
                        WHERE ct.id = $2
                          AND (NOT (ct.hidden OR co.hidden IS TRUE) OR tu.team_role <> 'member')
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
                        LEFT JOIN crm_companies co ON co.id = ct.company_id
                        WHERE ct.id = $1
                          AND ct.team_id = $2
                          AND (NOT (ct.hidden OR co.hidden IS TRUE) OR $3)
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
