//! Postgres implementation of [`CallRecordLinkStore`]: matches the people on a
//! call against the CRMs of the teams on it.

use std::collections::BTreeSet;

use call::domain::models::CallPeople;
use models_properties::EntityType;
use sqlx::PgPool;
use system_properties::{CrmRecordLink, SystemPropertiesService};
use uuid::Uuid;

use crate::domain::call_links::CallRecordLinkStore;

#[cfg(test)]
mod test;

/// Writes the Companies and Contacts properties of a call record from the
/// CRMs of the teams on the call.
#[derive(Clone)]
pub struct PgCallCrmLinker<S> {
    pool: PgPool,
    system_properties: S,
}

impl<S: SystemPropertiesService> PgCallCrmLinker<S> {
    /// Create a linker over the shared MacroDB pool.
    pub fn new(pool: PgPool, system_properties: S) -> Self {
        Self {
            pool,
            system_properties,
        }
    }

    /// CRM companies whose domain a person's address is at, and CRM contacts
    /// holding the address as any of their addresses, with or without a
    /// company, in the CRMs of the teams of the Macro accounts on the call.
    /// Every visible contact holding an address matches. A team's own members
    /// never match its CRM, and hidden records are skipped, as is a contact
    /// under a hidden company. Email contribution consent is independent.
    async fn matching_records(
        &self,
        people: &CallPeople,
    ) -> Result<(Vec<Uuid>, Vec<Uuid>), sqlx::Error> {
        // Account ids and emails compare case-insensitively, like the other
        // CRM lookups.
        let user_ids: Vec<String> = people
            .user_ids
            .iter()
            .map(|user_id| user_id.to_string().to_lowercase())
            .collect();
        let emails: Vec<String> = people
            .user_ids
            .iter()
            .map(|user_id| user_id.email_str().to_string())
            .chain(people.invitee_emails.iter().cloned())
            .collect();

        // Contacts are found from the address index, then read by id: the
        // `OFFSET 0` fences keep the planner from starting at every contact
        // of the team, or of the table, instead.
        let rows = sqlx::query!(
            r#"
            WITH teams AS (
                SELECT DISTINCT tu.team_id
                FROM team_user tu
                WHERE LOWER(tu.user_id) = ANY($1)
            ),
            people AS (
                SELECT DISTINCT LOWER(email) AS email
                FROM UNNEST($2::text[]) AS email
                WHERE STRPOS(email, '@') > 0
            ),
            outsiders AS (
                SELECT t.team_id, p.email, SPLIT_PART(p.email, '@', 2) AS domain
                FROM teams t
                CROSS JOIN people p
                WHERE NOT EXISTS (
                    SELECT 1 FROM team_user tu
                    WHERE tu.team_id = t.team_id AND LOWER(tu.user_id) = 'macro|' || p.email
                )
            )
            SELECT co.id AS "company_id?", NULL::uuid AS "contact_id?"
            FROM outsiders o
            JOIN crm_domains d ON d.team_id = o.team_id AND LOWER(d.domain) = o.domain
            JOIN crm_companies co ON co.id = d.company_id AND NOT co.hidden
            UNION
            SELECT NULL, ct.id
            FROM outsiders o
            CROSS JOIN LATERAL (
                SELECT ce.contact_id FROM crm_contact_emails ce WHERE ce.email = o.email OFFSET 0
            ) held
            CROSS JOIN LATERAL (
                SELECT ct.id, ct.team_id
                FROM crm_contacts ct
                LEFT JOIN crm_companies co ON co.id = ct.company_id
                WHERE ct.id = held.contact_id AND NOT ct.hidden AND co.hidden IS NOT TRUE
                OFFSET 0
            ) ct
            WHERE ct.team_id = o.team_id
            "#,
            &user_ids,
            &emails,
        )
        .fetch_all(&self.pool)
        .await?;

        let company_ids: BTreeSet<Uuid> = rows.iter().filter_map(|row| row.company_id).collect();
        let contact_ids: BTreeSet<Uuid> = rows.iter().filter_map(|row| row.contact_id).collect();
        Ok((
            company_ids.into_iter().collect(),
            contact_ids.into_iter().collect(),
        ))
    }
}

impl<S: SystemPropertiesService> CallRecordLinkStore for PgCallCrmLinker<S> {
    async fn link_call_record(
        &self,
        call_record_id: Uuid,
        people: &CallPeople,
    ) -> Result<(), rootcause::Report> {
        let (company_ids, contact_ids) = self.matching_records(people).await?;
        self.system_properties
            .link_crm_records(CrmRecordLink {
                entity_id: call_record_id.to_string(),
                entity_type: EntityType::CallRecord,
                company_ids,
                contact_ids,
            })
            .await?;
        Ok(())
    }
}
