//! Postgres implementation of [`CallRecordLinkStore`]: matches the people on a
//! call against the CRMs of the teams on it.

use std::collections::BTreeSet;

use call::domain::{models::CallPeople, records::CallProvider};
use models_properties::EntityType;
use phone_number::PhoneNumber;
use sqlx::PgPool;
use system_properties::{CrmRecordLink, SystemPropertiesService};
use uuid::Uuid;

use crate::domain::{call_links::CallRecordLinkStore, contact_phones::PhoneSource};

#[cfg(test)]
mod test;

/// Writes the Companies and Contacts properties of a call record from the
/// CRMs of the teams on the call.
#[derive(Clone)]
pub struct PgCallCrmLinker<S> {
    pool: PgPool,
    system_properties: S,
}

/// What the people on a call match in the CRM.
struct Matches {
    company_ids: Vec<Uuid>,
    contact_ids: Vec<Uuid>,
    /// Numbers of guests whose contact was found by email, to remember.
    learned_phones: Vec<(Uuid, PhoneNumber)>,
}

impl<S: SystemPropertiesService> PgCallCrmLinker<S> {
    /// Create a linker over the shared MacroDB pool.
    pub fn new(pool: PgPool, system_properties: S) -> Self {
        Self {
            pool,
            system_properties,
        }
    }

    /// CRM companies and contacts that the people on a call belong to, in
    /// the CRMs of the teams of the Macro accounts on the call. Each guest is
    /// matched by email first (company by domain, contact by address), then,
    /// only when no contact matched, by phone number. A team's own members
    /// never match its CRM, and hidden records and teams with the CRM
    /// disabled are skipped. A caller known only by a number nobody has
    /// creates nothing.
    async fn matching_records(&self, people: &CallPeople) -> Result<Matches, sqlx::Error> {
        // Account ids and emails compare case-insensitively, like the other
        // CRM lookups.
        let user_ids: Vec<String> = people
            .user_ids
            .iter()
            .map(|user_id| user_id.to_string().to_lowercase())
            .collect();
        // Accounts are guests with an email too, so their companies link.
        let (emails, phones): (Vec<Option<String>>, Vec<Option<String>>) = people
            .user_ids
            .iter()
            .map(|user_id| (Some(user_id.email_str().to_string()), None))
            .chain(
                people
                    .guests
                    .iter()
                    .map(|guest| (guest.email.clone(), guest.phone.clone())),
            )
            .unzip();

        let rows = sqlx::query!(
            r#"
            WITH teams AS (
                SELECT DISTINCT tu.team_id
                FROM team_user tu
                JOIN team_crm_settings s ON s.team_id = tu.team_id AND s.crm_enabled
                WHERE LOWER(tu.user_id) = ANY($1)
            ),
            guests AS (
                SELECT g.ord,
                       CASE WHEN STRPOS(g.email, '@') > 0 THEN LOWER(g.email) END AS email,
                       NULLIF(g.phone, '') AS phone
                FROM UNNEST($2::text[], $3::text[]) WITH ORDINALITY AS g(email, phone, ord)
            ),
            outsiders AS (
                SELECT t.team_id, g.ord, g.email, g.phone, SPLIT_PART(g.email, '@', 2) AS domain
                FROM teams t
                CROSS JOIN guests g
                WHERE g.email IS NULL OR NOT EXISTS (
                    SELECT 1 FROM team_user tu
                    WHERE tu.team_id = t.team_id AND LOWER(tu.user_id) = 'macro|' || g.email
                )
            ),
            by_email AS (
                SELECT o.team_id, o.ord, o.phone, co.id AS company_id, ct.id AS contact_id
                FROM outsiders o
                JOIN crm_domains d ON d.team_id = o.team_id AND LOWER(d.domain) = o.domain
                JOIN crm_companies co ON co.id = d.company_id AND NOT co.hidden
                LEFT JOIN crm_contacts ct
                    ON ct.company_id = co.id AND LOWER(ct.email) = o.email AND NOT ct.hidden
            ),
            by_phone AS (
                SELECT co.id AS company_id, ct.id AS contact_id
                FROM outsiders o
                JOIN crm_contact_phones p ON p.phone = o.phone
                JOIN crm_contacts ct ON ct.id = p.contact_id AND NOT ct.hidden
                JOIN crm_companies co
                    ON co.id = ct.company_id AND co.team_id = o.team_id AND NOT co.hidden
                WHERE NOT EXISTS (
                    SELECT 1 FROM by_email e
                    WHERE e.team_id = o.team_id AND e.ord = o.ord AND e.contact_id IS NOT NULL
                )
            )
            SELECT company_id AS "company_id!", contact_id AS "contact_id?",
                   phone AS "learned_phone?"
            FROM by_email
            UNION ALL
            SELECT company_id, contact_id, NULL FROM by_phone
            "#,
            &user_ids,
            &emails as &[Option<String>],
            &phones as &[Option<String>],
        )
        .fetch_all(&self.pool)
        .await?;

        let company_ids: BTreeSet<Uuid> = rows.iter().map(|row| row.company_id).collect();
        let contact_ids: BTreeSet<Uuid> = rows.iter().filter_map(|row| row.contact_id).collect();
        // Only Dialpad's numbers are known to be the caller's own line.
        let learned_phones = if people.provider == Some(CallProvider::Dialpad) {
            rows.iter()
                .filter_map(|row| {
                    let phone = PhoneNumber::parse(row.learned_phone.as_deref()?)?;
                    Some((row.contact_id?, phone))
                })
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect()
        } else {
            Vec::new()
        };
        Ok(Matches {
            company_ids: company_ids.into_iter().collect(),
            contact_ids: contact_ids.into_iter().collect(),
            learned_phones,
        })
    }

    /// Remember numbers Dialpad gave for contacts matched by email, keeping
    /// any the contact already has.
    async fn learn_phones(&self, phones: &[(Uuid, PhoneNumber)]) -> Result<(), sqlx::Error> {
        if phones.is_empty() {
            return Ok(());
        }
        let (contact_ids, numbers): (Vec<Uuid>, Vec<String>) = phones
            .iter()
            .map(|(contact_id, phone)| (*contact_id, phone.to_string()))
            .unzip();
        sqlx::query!(
            r#"
            INSERT INTO crm_contact_phones (contact_id, phone, source)
            SELECT l.contact_id, l.phone, $3
            FROM UNNEST($1::uuid[], $2::text[]) AS l(contact_id, phone)
            ON CONFLICT (contact_id, phone) DO NOTHING
            "#,
            &contact_ids,
            &numbers,
            PhoneSource::Dialpad.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

impl<S: SystemPropertiesService> CallRecordLinkStore for PgCallCrmLinker<S> {
    async fn link_call_record(
        &self,
        call_record_id: Uuid,
        people: &CallPeople,
    ) -> Result<(), rootcause::Report> {
        let matches = self.matching_records(people).await?;
        self.learn_phones(&matches.learned_phones).await?;
        self.system_properties
            .link_crm_records(CrmRecordLink {
                entity_id: call_record_id.to_string(),
                entity_type: EntityType::CallRecord,
                company_ids: matches.company_ids,
                contact_ids: matches.contact_ids,
            })
            .await?;
        Ok(())
    }
}
