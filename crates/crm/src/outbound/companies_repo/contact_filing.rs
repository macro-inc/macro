//! Filing a manual contact under the company for its email domain: the
//! company lookup creation shares, and the operator-run pass over contacts
//! that were created without one.

use super::{CompaniesRepositoryImpl, lock_timeout_as_contended};
use crate::domain::{
    contact_filing::{ContactFiling, ContactFilingRepository, UnfiledContact},
    generic_email_domains::is_generic_email_domain,
    model::CrmError,
};
use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Where a manual contact at a company domain goes.
pub(super) enum ManualContactCompany {
    /// The team's company for the domain, its row locked.
    Company {
        id: Uuid,
        /// Whether this transaction created it.
        created: bool,
    },
    /// The team keeps the domain out of email sync: no company is created
    /// for it and none is joined.
    BlockedDomain,
    /// The domain's company is hidden; a visible contact never goes under it.
    Hidden,
}

impl CompaniesRepositoryImpl {
    /// The company a manual contact at `normalized_domain` is filed under, as
    /// email sync files one: the team's company for the domain, created
    /// without a name of its own when the team has none. The caller holds the
    /// `(team, domain)` advisory lock; the company row stays locked so its
    /// `hidden` cannot change before the contact is written.
    pub(super) async fn company_for_manual_contact(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        team_id: &Uuid,
        normalized_domain: &str,
        now: DateTime<Utc>,
    ) -> Result<ManualContactCompany, CrmError> {
        if Self::domain_blocked(tx, team_id, normalized_domain).await? {
            return Ok(ManualContactCompany::BlockedDomain);
        }

        let (id, created) = match Self::find_company_by_domain(tx, team_id, normalized_domain)
            .await?
        {
            Some((id, _)) => (id, false),
            None => {
                Self::insert_company(tx, team_id, Some(normalized_domain), None, false, now, now)
                    .await?
            }
        };

        let hidden = sqlx::query_scalar!(
            "SELECT hidden FROM crm_companies WHERE id = $1 AND team_id = $2 FOR UPDATE",
            id,
            team_id,
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        match hidden {
            Some(false) => Ok(ManualContactCompany::Company { id, created }),
            Some(true) | None => Ok(ManualContactCompany::Hidden),
        }
    }
}

impl ContactFilingRepository for CompaniesRepositoryImpl {
    #[tracing::instrument(skip_all, fields(%team_id), err)]
    async fn list_unfiled_manual_contacts(
        &self,
        team_id: &Uuid,
        after: Option<&str>,
        limit: u16,
    ) -> Result<Vec<UnfiledContact>, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        sqlx::query!("SET LOCAL statement_timeout = '15s'")
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // Walks `crm_contacts_unfiled_email_idx (team_id, LOWER(email)) WHERE
        // company_id IS NULL` from the cursor; an address is never empty, so
        // the empty string starts the first page.
        let contacts = sqlx::query_as!(
            UnfiledContact,
            r#"
            SELECT id, LOWER(email) AS "email!", manually_created, hidden
            FROM crm_contacts
            WHERE team_id = $1
              AND company_id IS NULL
              AND LOWER(email) > COALESCE($2, '')
            ORDER BY LOWER(email)
            LIMIT $3
            "#,
            team_id,
            after,
            i64::from(limit),
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(contacts)
    }

    #[tracing::instrument(skip_all, fields(%team_id, %contact_id, dry_run), err)]
    async fn file_unfiled_contact(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        now: DateTime<Utc>,
        dry_run: bool,
    ) -> Result<ContactFiling, CrmError> {
        self.file_under_domain_company(team_id, contact_id, now, dry_run)
            .await
            .map_err(lock_timeout_as_contended)
    }
}

impl CompaniesRepositoryImpl {
    /// The transaction behind `file_unfiled_contact`.
    async fn file_under_domain_company(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        now: DateTime<Utc>,
        dry_run: bool,
    ) -> Result<ContactFiling, CrmError> {
        // A batch takes these locks once per contact. Bounding each wait
        // keeps a busy team from holding the operator's connection, and the
        // population queued behind the exclusive lock, for a whole batch.
        let mut tx = self.begin_population().await?;

        // The lock order of a contact edit: privacy, every domain involved,
        // the team, the company row, then the contact row.
        Self::lock_email_privacy(&mut tx, *team_id, true).await?;
        let Some(before) = Self::read_contact(&mut *tx, team_id, contact_id, true).await? else {
            return Ok(ContactFiling::NotUnfiled);
        };
        let (Some(primary), None) = (before.email.clone(), before.company_id) else {
            return Ok(ContactFiling::NotUnfiled);
        };
        if before.hidden {
            return Ok(ContactFiling::Archived);
        }
        let Some((_, company_domain)) = primary.split_once('@') else {
            return Ok(ContactFiling::NotUnfiled);
        };
        // The caller judged the address it listed. A primary changed since
        // to a provider address must not key a company.
        if is_generic_email_domain(company_domain) {
            return Ok(ContactFiling::NotUnfiled);
        }

        let mut domains: Vec<&str> = before
            .emails
            .iter()
            .filter_map(|address| address.split_once('@'))
            .map(|(_, domain)| domain)
            .chain([company_domain])
            .collect();
        domains.sort_unstable();
        domains.dedup();
        for domain in domains {
            Self::lock_team_domain(&mut tx, team_id, domain).await?;
        }
        if !Self::team_exists(&mut tx, team_id).await? {
            return Err(CrmError::CrmDisabledForTeam);
        }

        let (company_id, company_created) =
            match Self::company_for_manual_contact(&mut tx, team_id, company_domain, now).await? {
                ManualContactCompany::Company { id, created } => (id, created),
                ManualContactCompany::BlockedDomain => return Ok(ContactFiling::BlockedDomain),
                ManualContactCompany::Hidden => return Ok(ContactFiling::HiddenCompany),
            };

        let manual = sqlx::query_scalar!(
            "SELECT manually_created FROM crm_contacts WHERE id = $1 AND team_id = $2 FOR UPDATE",
            contact_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        // A contact email sync left without a company stays as sync left it.
        if manual != Some(true) {
            return Ok(ContactFiling::NotUnfiled);
        }
        let Some(current) = Self::read_contact(&mut *tx, team_id, contact_id, true).await? else {
            return Ok(ContactFiling::NotUnfiled);
        };
        // Archived since the first read: returning drops the transaction, so
        // a company it inserted for the domain goes with it.
        if current.hidden {
            return Ok(ContactFiling::Archived);
        }
        // The locks were chosen from the first read; a contact edited since
        // is left for a later run.
        if current.company_id.is_some()
            || current.email != before.email
            || current.emails != before.emails
        {
            return Ok(ContactFiling::NotUnfiled);
        }

        // As for any contact that gains a company: nobody else in the team
        // may hold one of its addresses. Both fences keep the read on the
        // address index and one primary-key probe per holder; unfenced, a
        // generic plan reads every contact of the team instead.
        let shared = sqlx::query_scalar!(
            r#"SELECT EXISTS (
                   SELECT 1
                   FROM (
                       SELECT ce.contact_id
                       FROM crm_contact_emails ce
                       WHERE ce.email = ANY($2) AND ce.contact_id <> $3
                       OFFSET 0
                   ) held
                   CROSS JOIN LATERAL (
                       SELECT 1
                       FROM crm_contacts ct
                       WHERE ct.id = held.contact_id AND ct.team_id = $1
                       OFFSET 0
                   ) same_team
               ) AS "shared!""#,
            team_id,
            &before.emails,
            contact_id,
        )
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if shared {
            return Ok(ContactFiling::DuplicateAddress);
        }

        sqlx::query!(
            "UPDATE crm_contacts SET company_id = $3 WHERE id = $1 AND team_id = $2",
            contact_id,
            team_id,
            company_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Self::record_contact_matching_change(&mut tx, *team_id, *contact_id).await?;

        // A dry run takes the same path and drops its transaction.
        if !dry_run {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        Ok(ContactFiling::Filed { company_created })
    }
}
