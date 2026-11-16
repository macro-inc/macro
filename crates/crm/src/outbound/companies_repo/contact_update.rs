use super::CompaniesRepositoryImpl;
use crate::domain::{
    contact_update::ContactFieldUpdate,
    model::{CrmContact, CrmError},
};
use uuid::Uuid;

impl CompaniesRepositoryImpl {
    #[tracing::instrument(skip_all, fields(%team_id, %contact_id), err)]
    pub(super) async fn update_contact_details(
        &self,
        team_id: &Uuid,
        contact_id: &Uuid,
        update: &ContactFieldUpdate,
        include_hidden: bool,
    ) -> Result<CrmContact, CrmError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        // Reassignment changes the parent used by contribution/read eligibility.
        // Serialize it with privacy changes and population before domain/row locks;
        // taking this lock never enrolls a mailbox or requires consent.
        Self::lock_email_privacy(&mut tx, *team_id, true).await?;
        let before = Self::read_contact(&mut *tx, team_id, contact_id, true)
            .await?
            .ok_or(CrmError::ContactNotFoundForTeam)?;

        let mut company_ids: Vec<Uuid> = before.company_id.into_iter().collect();
        if let ContactFieldUpdate::Company(destination) = update {
            company_ids.push(*destination);
        }
        company_ids.sort_unstable();
        company_ids.dedup();
        let edited_address = match update {
            ContactFieldUpdate::Email(email)
            | ContactFieldUpdate::AddEmail(email)
            | ContactFieldUpdate::RemoveEmail(email) => Some(email),
            ContactFieldUpdate::Company(_) | ContactFieldUpdate::NoCompany => None,
        };

        // Sync teardown takes domain locks before touching companies/contacts.
        // Gather every lock before taking any row lock; never invert that order.
        let mut domains = sqlx::query_scalar!(
            "SELECT LOWER(domain) AS \"domain!\" FROM crm_domains WHERE team_id = $1 AND company_id = ANY($2)",
            team_id,
            &company_ids,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        for address in before.emails.iter().chain(edited_address) {
            if let Some((_, domain)) = address.split_once('@') {
                domains.push(domain.to_ascii_lowercase());
            }
        }
        domains.sort_unstable();
        domains.dedup();
        for domain in domains {
            Self::lock_team_domain(&mut tx, team_id, &domain).await?;
        }
        if !Self::team_exists(&mut tx, team_id).await? {
            return Err(CrmError::CrmDisabledForTeam);
        }
        let companies = sqlx::query!(
            "SELECT id, hidden FROM crm_companies WHERE team_id = $1 AND id = ANY($2) ORDER BY id FOR UPDATE",
            team_id,
            &company_ids,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // The contact row lock also covers its address rows: only this path
        // and the primary-address trigger write them, both under that lock.
        sqlx::query!(
            "SELECT id FROM crm_contacts WHERE id = $1 AND team_id = $2 FOR UPDATE",
            contact_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .ok_or(CrmError::ContactNotFoundForTeam)?;
        let current = Self::read_contact(&mut *tx, team_id, contact_id, true)
            .await?
            .ok_or(CrmError::ContactNotFoundForTeam)?;

        let parent_hidden = companies
            .iter()
            .any(|company| Some(company.id) == current.company_id && company.hidden);
        if !include_hidden && (current.hidden || parent_hidden) {
            return Err(CrmError::ContactNotFoundForTeam);
        }
        // The locks above were chosen from the first read. A contact that
        // moved or changed addresses since may need others, so only an edit
        // it already satisfies is answered.
        let moved = current.company_id != before.company_id || current.emails != before.emails;
        let change = update.resolve(&current)?;
        if change.changes_nothing(&current) {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(current);
        }
        if moved {
            return Err(CrmError::InvalidRequest(
                "contact changed; reload and try again".into(),
            ));
        }

        if change.company_id != current.company_id {
            if parent_hidden && !current.hidden {
                return Err(CrmError::CompanyHidden);
            }
            if let Some(destination) = change.company_id {
                let company = companies
                    .iter()
                    .find(|company| company.id == destination)
                    .ok_or(CrmError::CompanyNotFoundForTeam)?;
                if company.hidden {
                    return Err(CrmError::CompanyHidden);
                }
            }
        }

        // A new address must be free across the team; a contact that moves
        // must not share any of its addresses. Every email writer takes its
        // domain lock before rows. Count archived records too, without
        // exposing restricted ones.
        let must_be_free: Vec<String> = if change.company_id != current.company_id {
            current
                .emails
                .iter()
                .cloned()
                .chain(change.added.clone())
                .collect()
        } else {
            change.added.iter().cloned().collect()
        };
        if !must_be_free.is_empty() {
            let duplicates = sqlx::query!(
                r#"SELECT COUNT(*) AS "count!",
                          COALESCE(BOOL_OR(ct.hidden OR COALESCE(co.hidden, FALSE)), FALSE) AS "hidden!"
                   FROM crm_contact_emails ce
                   JOIN crm_contacts ct ON ct.id = ce.contact_id
                   LEFT JOIN crm_companies co ON co.id = ct.company_id
                   WHERE ce.email = ANY($2) AND ct.team_id = $1 AND ct.id <> $3"#,
                team_id,
                &must_be_free,
                contact_id,
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            if duplicates.count > 0 {
                if !include_hidden && duplicates.hidden {
                    return Err(CrmError::InvalidRequest(
                        "contact change unavailable".into(),
                    ));
                }
                return Err(CrmError::ContactAlreadyExistsForTeam);
            }
        }

        if let Some(added) = &change.added {
            sqlx::query!(
                "INSERT INTO crm_contact_emails (contact_id, email) VALUES ($1, $2) ON CONFLICT (contact_id, email) DO NOTHING",
                contact_id,
                added,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }
        sqlx::query!(
            "UPDATE crm_contacts SET email = $3, company_id = $4, manually_created = TRUE WHERE id = $1 AND team_id = $2",
            contact_id,
            team_id,
            change.primary,
            change.company_id,
        )
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if error
                .as_database_error()
                .is_some_and(|error| error.is_unique_violation())
            {
                CrmError::ContactAlreadyExistsForTeam
            } else {
                CrmError::StorageLayerError(error.into())
            }
        })?;
        // Nothing else is deleted: the contact stops matching this address,
        // so its mail no longer shows on the contact and sync no longer
        // routes it here.
        if let Some(removed) = &change.removed {
            sqlx::query!(
                "DELETE FROM crm_contact_emails WHERE contact_id = $1 AND email = $2",
                contact_id,
                removed,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        }

        let contact = Self::read_contact(&mut *tx, team_id, contact_id, true)
            .await?
            .ok_or(CrmError::ContactNotFoundForTeam)?;
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(contact)
    }
}
