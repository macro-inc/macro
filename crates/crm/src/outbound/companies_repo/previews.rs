//! Company and contact chip titles for many ids in one statement per kind.
//!
//! Visibility is the single reads' (`get_crm_company_access` and
//! `get_crm_contact_access` in `entity_access`, then `get_company_for_team`
//! and `get_contact_for_team`): the viewer must belong to the record's team,
//! have effective CRM access, and a plain member sees no hidden company,
//! hidden contact, or contact under a hidden company. Admins and owners see
//! hidden records.
//!
//! Each statement reads its records by primary key behind an `OFFSET 0`
//! fence, then checks the team. Unfenced, a custom plan can AND the ids with
//! the viewer team's whole `team_id` index, which grows with the team; the
//! planner assumes few of the ids belong to it.

use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::{
    model::CrmError,
    previews::{CrmCompanyPreview, CrmContactPreview},
};

impl CompaniesRepositoryImpl {
    #[tracing::instrument(name = "crm.preview_companies", skip_all, fields(id_count = company_ids.len()), err)]
    pub(super) async fn query_company_previews(
        &self,
        viewer_id: &str,
        company_ids: &[Uuid],
    ) -> Result<Vec<CrmCompanyPreview>, CrmError> {
        // The name is the company read's: the team's override, else the
        // directory name of the first domain by `created_at`, which also
        // titles a company with neither. Each company reads only its own
        // domains, through `crm_domains_company_id_idx`.
        sqlx::query_as!(
            CrmCompanyPreview,
            r#"
            SELECT
                c.id AS "id!",
                COALESCE(c.custom_name, dd.name) AS "name?",
                primary_domain.domain AS "primary_domain?",
                c.last_interaction AS "updated_at!"
            FROM (
                SELECT id, team_id, custom_name, hidden, last_interaction
                FROM crm_companies
                WHERE id = ANY($2)
                OFFSET 0
            ) c
            JOIN team_user tu
                ON tu.team_id = c.team_id
               AND tu.user_id = $1
               AND (tu.crm_access OR tu.team_role <> 'member')
            LEFT JOIN LATERAL (
                SELECT d.domain
                FROM crm_domains d
                WHERE d.company_id = c.id
                ORDER BY d.created_at, d.id
                LIMIT 1
            ) primary_domain ON TRUE
            LEFT JOIN crm_domain_directory dd
                ON LOWER(dd.domain) = LOWER(primary_domain.domain)
            WHERE NOT c.hidden OR tu.team_role <> 'member'
            "#,
            viewer_id,
            company_ids,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| CrmError::StorageLayerError(error.into()))
    }

    #[tracing::instrument(name = "crm.preview_contacts", skip_all, fields(id_count = contact_ids.len()), err)]
    pub(super) async fn query_contact_previews(
        &self,
        viewer_id: &str,
        contact_ids: &[Uuid],
    ) -> Result<Vec<CrmContactPreview>, CrmError> {
        sqlx::query_as!(
            CrmContactPreview,
            r#"
            SELECT
                ct.id AS "id!",
                ct.name,
                ct.email,
                ct.updated_at AS "updated_at!"
            FROM (
                SELECT id, team_id, company_id, name, email, hidden, updated_at
                FROM crm_contacts
                WHERE id = ANY($2)
                OFFSET 0
            ) ct
            JOIN team_user tu
                ON tu.team_id = ct.team_id
               AND tu.user_id = $1
               AND (tu.crm_access OR tu.team_role <> 'member')
            LEFT JOIN crm_companies co
                ON co.id = ct.company_id
            WHERE NOT (ct.hidden OR co.hidden IS TRUE) OR tu.team_role <> 'member'
            "#,
            viewer_id,
            contact_ids,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|error| CrmError::StorageLayerError(error.into()))
    }
}
