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
        let before = sqlx::query!(
            "SELECT company_id, email FROM crm_contacts WHERE id = $1 AND team_id = $2",
            contact_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .ok_or(CrmError::ContactNotFoundForTeam)?;

        let company_id = match update {
            ContactFieldUpdate::Company(id) => Some(*id),
            ContactFieldUpdate::Email(_) => before.company_id,
        };
        let email = match update {
            ContactFieldUpdate::Email(email) => Some(email.as_str()),
            ContactFieldUpdate::Company(_) => before.email.as_deref(),
        };
        let mut company_ids: Vec<Uuid> = before.company_id.into_iter().chain(company_id).collect();
        company_ids.sort_unstable();
        company_ids.dedup();

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
        for address in [before.email.as_deref(), email].into_iter().flatten() {
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
        let current = sqlx::query_as!(
            CrmContact,
            r#"SELECT id, company_id, email, name, hidden, first_interaction,
                      last_interaction, created_at, updated_at
               FROM crm_contacts WHERE id = $1 AND team_id = $2 FOR UPDATE"#,
            contact_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .ok_or(CrmError::ContactNotFoundForTeam)?;
        if (current.company_id != before.company_id || current.email != before.email)
            && !(current.company_id == company_id && current.email.as_deref() == email)
        {
            return Err(CrmError::InvalidRequest(
                "contact changed; reload and try again".into(),
            ));
        }
        let parent_hidden = companies
            .iter()
            .any(|company| Some(company.id) == current.company_id && company.hidden);
        if !include_hidden && (current.hidden || parent_hidden) {
            return Err(CrmError::ContactNotFoundForTeam);
        }
        update.validate(&current)?;
        if let ContactFieldUpdate::Company(_) = update {
            if parent_hidden && !current.hidden && company_id != current.company_id {
                return Err(CrmError::CompanyHidden);
            }
            if let Some(destination) = company_id {
                let company = companies
                    .iter()
                    .find(|company| company.id == destination)
                    .ok_or(CrmError::CompanyNotFoundForTeam)?;
                if company.hidden && Some(destination) != current.company_id {
                    return Err(CrmError::CompanyHidden);
                }
            }
        }
        if current.email.as_deref() == email && current.company_id == company_id {
            tx.commit()
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            return Ok(current);
        }
        // Every email writer takes its domain lock before rows. Count across the
        // whole team, including archived records, without exposing restricted ones.
        let duplicates = sqlx::query!(
            r#"SELECT ct.hidden OR COALESCE(co.hidden, FALSE) AS "hidden!"
               FROM crm_contacts ct LEFT JOIN crm_companies co ON co.id = ct.company_id
               WHERE ct.team_id = $1 AND LOWER(ct.email) = $2 AND ct.id <> $3"#,
            team_id,
            email,
            contact_id,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        if !duplicates.is_empty() {
            if !include_hidden && duplicates.iter().any(|row| row.hidden) {
                return Err(CrmError::InvalidRequest(
                    "contact change unavailable".into(),
                ));
            }
            return Err(CrmError::ContactAlreadyExistsForTeam);
        }
        let contact = sqlx::query_as!(
            CrmContact,
            r#"UPDATE crm_contacts SET email = $3, company_id = $4, manually_created = TRUE
               WHERE id = $1 AND team_id = $2
               RETURNING id, company_id, email, name, hidden, first_interaction,
                         last_interaction, created_at, updated_at"#,
            contact_id,
            team_id,
            email,
            company_id,
        )
        .fetch_one(&mut *tx)
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
        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        Ok(contact)
    }
}
