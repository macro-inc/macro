use super::CompaniesRepositoryImpl;
use crate::domain::{
    companies_repo::CompaniesRepository,
    company_domains::{
        CompanyDomainEdit, CompanyDomainEditor, CompanyDomainUpdate, LockedCompanyDomains,
    },
    model::{CompanyDomainHolder, CrmCompanyWithContacts, CrmError},
};
use uuid::Uuid;

impl CompaniesRepositoryImpl {
    #[tracing::instrument(
        name = "crm.company_domain_edit",
        skip_all,
        fields(%team_id, %company_id, outcome = tracing::field::Empty),
        err
    )]
    pub(super) async fn update_company_domain_rows(
        &self,
        team_id: &Uuid,
        company_id: &Uuid,
        update: &CompanyDomainUpdate,
        editor: CompanyDomainEditor,
    ) -> Result<CrmCompanyWithContacts, CrmError> {
        let include_hidden = editor == CompanyDomainEditor::Admin;
        let domain = update.domain();
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        // A company's domains decide whose mail is its own and, while its sync
        // is off, which mail stays out of the CRM. Serialize with privacy
        // changes and population before any domain or row lock. Sync and
        // archive writers take this lock too, so `email_sync` and `hidden`
        // hold until commit.
        Self::lock_email_privacy(&mut tx, *team_id, true).await?;
        let company = sqlx::query!(
            r#"SELECT hidden, email_sync,
                      EXISTS (SELECT 1 FROM crm_domains d
                              WHERE d.company_id = scoped.id AND LOWER(d.domain) = $3) AS "holds!"
               FROM (SELECT id, team_id, hidden, email_sync FROM crm_companies WHERE id = $1 OFFSET 0) scoped
               WHERE team_id = $2"#,
            company_id,
            team_id,
            domain,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .filter(|company| include_hidden || !company.hidden)
        .ok_or(CrmError::CompanyNotFoundForTeam)?;

        // A domain added to a company whose sync is off is kept out of email
        // sync with the others, so it is checked as a new team block is:
        // against members' connected mailboxes, before domain locks.
        let adds = matches!(update, CompanyDomainUpdate::Add(_)) && !company.holds;
        if adds && !company.email_sync {
            Self::guard_team_domain_exclusion(&mut tx, *team_id, domain).await?;
        }

        Self::lock_team_domain(&mut tx, team_id, domain).await?;
        if !Self::team_exists(&mut tx, team_id).await? {
            return Err(CrmError::CrmDisabledForTeam);
        }
        let team_named = sqlx::query_scalar!(
            r#"SELECT custom_name IS NOT NULL AS "team_named!" FROM crm_companies
               WHERE id = $1 AND team_id = $2 FOR UPDATE"#,
            company_id,
            team_id,
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?
        .ok_or(CrmError::CompanyNotFoundForTeam)?;
        let domains = sqlx::query_scalar!(
            r#"SELECT LOWER(domain) AS "domain!" FROM crm_domains
               WHERE company_id = $1 AND team_id = $2
               ORDER BY created_at, id"#,
            company_id,
            team_id,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;
        let holder = match update {
            CompanyDomainUpdate::Add(domain) => {
                Self::other_domain_holder(&mut tx, team_id, company_id, domain).await?
            }
            CompanyDomainUpdate::Remove(_) => None,
        };

        let current = LockedCompanyDomains {
            domains,
            team_named,
            email_sync: company.email_sync,
            holder,
        };
        let edit = update.resolve(&current, editor)?;
        let outcome = match edit {
            CompanyDomainEdit::Unchanged => "unchanged",
            CompanyDomainEdit::Insert => "added",
            CompanyDomainEdit::Delete { .. } => "removed",
        };
        tracing::Span::current().record("outcome", outcome);

        match edit {
            CompanyDomainEdit::Unchanged => {}
            CompanyDomainEdit::Insert => {
                // The primary domain is the oldest, so a new domain is dated
                // after every domain the company holds, even one written by a
                // transaction that started later than this one.
                sqlx::query!(
                    r#"INSERT INTO crm_domains (id, company_id, team_id, domain, created_at)
                       SELECT $1, $2, $3, $4,
                              GREATEST(clock_timestamp(), MAX(created_at) + INTERVAL '1 microsecond')
                       FROM crm_domains WHERE company_id = $2"#,
                    Uuid::now_v7(),
                    company_id,
                    team_id,
                    domain,
                )
                .execute(&mut *tx)
                .await
                .map_err(|error| {
                    if error
                        .as_database_error()
                        .is_some_and(|error| error.is_unique_violation())
                    {
                        CrmError::CompanyDomainTaken(None)
                    } else {
                        CrmError::StorageLayerError(error.into())
                    }
                })?;
            }
            CompanyDomainEdit::Delete { .. } => {
                // Only the domain's row goes: contacts keep their company and
                // addresses, and mail is untouched.
                sqlx::query!(
                    r#"DELETE FROM crm_domains
                       WHERE company_id = $1 AND team_id = $2 AND LOWER(domain) = $3"#,
                    company_id,
                    team_id,
                    domain,
                )
                .execute(&mut *tx)
                .await
                .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            }
        }

        if edit != CompanyDomainEdit::Unchanged {
            // The team chose these domains, so sync's orphan cleanup must not
            // delete the company and lose them.
            sqlx::query!(
                "UPDATE crm_companies SET manually_created = TRUE WHERE id = $1 AND team_id = $2",
                company_id,
                team_id,
            )
            .execute(&mut *tx)
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;
            Self::record_company_matching_change(&mut tx, *team_id, *company_id).await?;
        }

        // Mail from the domain may sync again, so earlier mail is gathered as
        // when a domain is unblocked.
        if edit
            == (CompanyDomainEdit::Delete {
                lifts_exclusion: true,
            })
        {
            Self::schedule_contribution_history(&mut tx, *team_id, None).await?;
        }

        tx.commit()
            .await
            .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        self.get_company_for_team(team_id, company_id, include_hidden, false)
            .await?
            .ok_or(CrmError::CompanyNotFoundForTeam)
    }

    /// The team's company other than `company_id` that tracks `domain`, named
    /// as listings name it: the team's name, else its primary domain's
    /// directory name, else that domain.
    async fn other_domain_holder(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        team_id: &Uuid,
        company_id: &Uuid,
        domain: &str,
    ) -> Result<Option<CompanyDomainHolder>, CrmError> {
        let row = sqlx::query!(
            r#"SELECT c.id, c.hidden,
                      COALESCE(c.custom_name, primary_domain.name, primary_domain.domain) AS name
               FROM crm_domains d
               JOIN crm_companies c ON c.id = d.company_id
               LEFT JOIN LATERAL (
                   SELECT pd.domain, dd.name
                   FROM crm_domains pd
                   LEFT JOIN crm_domain_directory dd ON LOWER(dd.domain) = LOWER(pd.domain)
                   WHERE pd.company_id = c.id
                   ORDER BY pd.created_at, pd.id
                   LIMIT 1
               ) primary_domain ON TRUE
               WHERE d.team_id = $1 AND c.team_id = $1
                 AND LOWER(d.domain) = $2 AND c.id <> $3
               LIMIT 1"#,
            team_id,
            domain,
            company_id,
        )
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| CrmError::StorageLayerError(e.into()))?;

        Ok(row.map(|row| CompanyDomainHolder {
            company_id: row.id,
            name: row.name,
            hidden: row.hidden,
        }))
    }
}
