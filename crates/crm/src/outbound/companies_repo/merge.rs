//! A company merge's own rows: the locks it takes, in the order every CRM
//! writer takes them; the state its review is built from; and the writes that
//! fold the merged companies into the one that stays.

use std::collections::HashMap;

use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::{
    model::CrmError,
    record_merge::{MergeError, MergeTargets, plan::FiledPerson},
};
use crate::outbound::record_merge::MergeChange;

fn db(error: sqlx::Error) -> MergeError {
    MergeError::Crm(CrmError::StorageLayerError(error.into()))
}

/// One domain of a merged company.
#[derive(Debug, Clone)]
pub(crate) struct MergeDomain {
    pub(crate) domain: String,
}

/// A company as the merge finds it.
#[derive(Debug, Clone)]
pub(crate) struct MergeCompany {
    pub(crate) id: Uuid,
    /// As listings name it: the team's name, else its primary domain's.
    pub(crate) name: String,
    pub(crate) email_sync: bool,
    /// Primary (oldest) first.
    pub(crate) domains: Vec<MergeDomain>,
}

/// What a company merge's review is built from.
#[derive(Debug, Clone)]
pub(crate) struct CompanyMergeState {
    pub(crate) survivor: MergeCompany,
    /// In the targets' order.
    pub(crate) sources: Vec<MergeCompany>,
    /// Everyone filed under any of the companies, archived people too.
    pub(crate) people: Vec<FiledPerson>,
}

impl CompanyMergeState {
    /// The domains each merged company has now.
    pub(crate) fn source_domains(&self) -> HashMap<Uuid, Vec<String>> {
        self.sources
            .iter()
            .map(|company| {
                (
                    company.id,
                    company.domains.iter().map(|d| d.domain.clone()).collect(),
                )
            })
            .collect()
    }

    /// Domains joining a company that stays out of sync, or leaving one that
    /// was: they stay out of sync after the merge.
    pub(crate) fn kept_out(&self) -> Vec<String> {
        let mut kept: Vec<String> = self
            .sources
            .iter()
            .filter(|source| !self.survivor.email_sync || !source.email_sync)
            .flat_map(|source| source.domains.iter().map(|d| d.domain.clone()))
            .collect();
        kept.sort();
        kept
    }

    /// People moving to the company that stays.
    pub(crate) fn moving_people(&self) -> usize {
        self.people
            .iter()
            .filter(|person| person.record_id != self.survivor.id)
            .count()
    }
}

impl CompaniesRepositoryImpl {
    /// The team's exclusive privacy lock, which every merge takes first.
    pub(crate) async fn lock_merge_privacy(
        conn: &mut PgConnection,
        team: Uuid,
    ) -> Result<(), MergeError> {
        Ok(Self::lock_email_privacy(conn, team, true).await?)
    }

    /// Take the merge's CRM locks: the exclusive privacy lock, the guard for
    /// domains that newly stop syncing, every domain's lock in order, the
    /// team, then the companies and their people, each in id order. Returns
    /// the companies' state, read under those locks.
    #[tracing::instrument(name = "crm.merge.lock_companies", skip_all, fields(team_id = %team, companies = targets.all_sorted().len()), err)]
    pub(crate) async fn lock_company_merge(
        conn: &mut PgConnection,
        team: Uuid,
        targets: &MergeTargets,
    ) -> Result<CompanyMergeState, MergeError> {
        Self::lock_email_privacy(&mut *conn, team, true).await?;
        // Sync and archive writers hold the privacy lock, so these flags and
        // domains stay as read until commit.
        let state = Self::company_merge_state(&mut *conn, team, targets).await?;
        if !state.survivor.email_sync {
            for domain in state.kept_out() {
                Self::guard_team_domain_exclusion(&mut *conn, team, &domain).await?;
            }
        }
        let mut domains: Vec<&str> = state
            .sources
            .iter()
            .chain(std::iter::once(&state.survivor))
            .flat_map(|company| company.domains.iter().map(|d| d.domain.as_str()))
            .collect();
        domains.sort_unstable();
        domains.dedup();
        for domain in domains {
            Self::lock_team_domain(&mut *conn, &team, domain).await?;
        }
        if sqlx::query_scalar!("SELECT id FROM team WHERE id = $1 FOR KEY SHARE", team)
            .fetch_optional(&mut *conn)
            .await
            .map_err(db)?
            .is_none()
        {
            return Err(CrmError::CrmDisabledForTeam.into());
        }

        // The companies were found in the team above; lock exactly them.
        let ids = targets.all_sorted();
        let locked = sqlx::query_scalar!(
            "SELECT id FROM crm_companies WHERE id = ANY($1) ORDER BY id FOR UPDATE",
            &ids,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        if locked.len() != ids.len() {
            return Err(MergeError::RecordUnavailable);
        }
        sqlx::query_scalar!(
            r#"SELECT ct.id FROM (SELECT id, team_id FROM crm_contacts WHERE company_id = ANY($1) OFFSET 0) ct
               WHERE ct.team_id = $2 ORDER BY ct.id FOR UPDATE"#,
            &ids,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;

        // Read again: a person may have been filed between the reads.
        Self::company_merge_state(conn, team, targets).await
    }

    /// The companies of a merge as they are now. A record merged away earlier
    /// is named by its current one; anything else missing, in another team,
    /// or archived is refused.
    pub(crate) async fn company_merge_state(
        conn: &mut PgConnection,
        team: Uuid,
        targets: &MergeTargets,
    ) -> Result<CompanyMergeState, MergeError> {
        let ids = targets.all_sorted();
        // Probe each id by its key before the team filter, so stale
        // statistics can't turn this into a team scan.
        let rows = sqlx::query!(
            r#"SELECT c.id AS "id!", c.hidden AS "hidden!", c.email_sync AS "email_sync!",
                      COALESCE(c.custom_name, primary_domain.name, primary_domain.domain, 'Unnamed company') AS "name!"
               FROM UNNEST($1::uuid[]) AS wanted(id)
               CROSS JOIN LATERAL (
                   SELECT id, team_id, hidden, email_sync, custom_name FROM crm_companies
                   WHERE id = wanted.id OFFSET 0
               ) c
               LEFT JOIN LATERAL (
                   SELECT pd.domain, dd.name
                   FROM crm_domains pd
                   LEFT JOIN crm_domain_directory dd ON LOWER(dd.domain) = LOWER(pd.domain)
                   WHERE pd.company_id = c.id
                   ORDER BY pd.created_at, pd.id
                   LIMIT 1
               ) primary_domain ON TRUE
               WHERE c.team_id = $2"#,
            &ids,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;

        if rows.len() != ids.len() {
            let found: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
            let missing: Vec<Uuid> = ids.into_iter().filter(|id| !found.contains(id)).collect();
            let merged = sqlx::query!(
                r#"SELECT a.retired_id, a.company_id
                   FROM crm_company_aliases a
                   JOIN crm_companies c ON c.id = a.company_id
                   WHERE a.retired_id = ANY($1) AND c.team_id = $2
                   ORDER BY a.retired_id LIMIT 1"#,
                &missing,
                team,
            )
            .fetch_optional(&mut *conn)
            .await
            .map_err(db)?;
            return Err(match merged {
                Some(alias) => MergeError::AlreadyMerged {
                    record_id: alias.retired_id,
                    current_id: alias.company_id,
                },
                None => MergeError::RecordUnavailable,
            });
        }
        if let Some(hidden) = rows.iter().find(|row| row.hidden) {
            return Err(MergeError::RecordHidden(hidden.id));
        }

        let domains = sqlx::query!(
            r#"SELECT d.company_id, LOWER(d.domain) AS "domain!"
               FROM (SELECT company_id, team_id, domain, created_at, id FROM crm_domains
                     WHERE company_id = ANY($1) OFFSET 0) d
               WHERE d.team_id = $2
               ORDER BY d.company_id, d.created_at, d.id"#,
            &targets.all_sorted(),
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        let mut by_company: HashMap<Uuid, Vec<MergeDomain>> = HashMap::new();
        for row in domains {
            by_company
                .entry(row.company_id)
                .or_default()
                .push(MergeDomain { domain: row.domain });
        }
        let company = |id: Uuid| -> MergeCompany {
            let row = rows
                .iter()
                .find(|row| row.id == id)
                .expect("every target was found");
            MergeCompany {
                id,
                name: row.name.clone(),
                email_sync: row.email_sync,
                domains: by_company.get(&id).cloned().unwrap_or_default(),
            }
        };

        let people = sqlx::query!(
            r#"SELECT ct.id, ct.company_id AS "company_id!", ct.name, ct.hidden,
                      COALESCE((SELECT array_agg(LOWER(e.email) ORDER BY LOWER(e.email))
                                FROM crm_contact_emails e WHERE e.contact_id = ct.id), '{}') AS "addresses!"
               FROM (SELECT id, team_id, company_id, name, hidden FROM crm_contacts
                     WHERE company_id = ANY($1) OFFSET 0) ct
               WHERE ct.team_id = $2
               ORDER BY ct.id"#,
            &targets.all_sorted(),
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;

        Ok(CompanyMergeState {
            survivor: company(targets.survivor()),
            sources: targets.sources().iter().copied().map(company).collect(),
            people: people
                .into_iter()
                .map(|row| FiledPerson {
                    contact_id: row.id,
                    name: row.name,
                    record_id: row.company_id,
                    archived: row.hidden,
                    addresses: row.addresses,
                })
                .collect(),
        })
    }

    /// Fold the merged companies into the one that stays: their domains join
    /// it after its own (so its primary domain and name stay), their people
    /// are filed under it, domains whose sync was off stay out of sync, and
    /// their old ids name it. The merged companies are deleted last, once
    /// nothing that cascades from them is left. Every changed row is returned
    /// as it was.
    #[tracing::instrument(name = "crm.merge.fold_companies", skip_all, fields(team_id = %team, %merge_id), err)]
    pub(crate) async fn fold_companies(
        conn: &mut PgConnection,
        team: Uuid,
        merge_id: Uuid,
        state: &CompanyMergeState,
    ) -> Result<Vec<MergeChange>, MergeError> {
        let survivor = state.survivor.id;
        let sources: Vec<Uuid> = state.sources.iter().map(|company| company.id).collect();
        let mut changes = Vec::new();

        let domains = sqlx::query!(
            r#"WITH moving AS MATERIALIZED (
                   SELECT id, company_id, created_at,
                          row_number() OVER (ORDER BY created_at, id) AS place
                   FROM crm_domains WHERE company_id = ANY($2) AND team_id = $3
               ), after AS (
                   SELECT GREATEST(clock_timestamp(), MAX(created_at)) AS at
                   FROM crm_domains WHERE company_id = $1
               ), moved AS (
                   UPDATE crm_domains d
                   SET company_id = $1,
                       created_at = (SELECT at FROM after) + moving.place * INTERVAL '1 microsecond'
                   FROM moving WHERE d.id = moving.id
                   RETURNING d.id
               )
               SELECT moving.id, moving.company_id, moving.created_at
               FROM moving JOIN moved USING (id) ORDER BY moving.place"#,
            survivor,
            &sources,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(domains.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_domains",
                json!({ "id": row.id }),
                json!({ "company_id": row.company_id, "created_at": row.created_at }),
            )
        }));

        let people = sqlx::query!(
            r#"WITH moving AS MATERIALIZED (
                   SELECT ct.id, ct.company_id FROM (
                       SELECT id, team_id, company_id FROM crm_contacts WHERE company_id = ANY($2) OFFSET 0
                   ) ct WHERE ct.team_id = $3
               ), moved AS (
                   UPDATE crm_contacts ct SET company_id = $1, updated_at = NOW()
                   FROM moving WHERE ct.id = moving.id
                   RETURNING ct.id
               )
               SELECT moving.id, moving.company_id AS "company_id!" FROM moving JOIN moved USING (id)
               ORDER BY moving.id"#,
            survivor,
            &sources,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(people.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contacts",
                json!({ "id": row.id }),
                json!({ "company_id": row.company_id }),
            )
        }));

        // The company that stays keeps its setting. A merged company whose
        // sync was off keeps its domains out as team blocks, which match mail
        // exactly as its setting did.
        if state.survivor.email_sync {
            let off: Vec<String> = state
                .sources
                .iter()
                .filter(|source| !source.email_sync)
                .flat_map(|source| source.domains.iter().map(|d| d.domain.clone()))
                .collect();
            if !off.is_empty() {
                let blocked = sqlx::query_scalar!(
                    r#"INSERT INTO crm_blocked_domains (team_id, domain)
                       SELECT $1, domain FROM UNNEST($2::text[]) AS d(domain)
                       ON CONFLICT (team_id, domain) DO NOTHING
                       RETURNING domain"#,
                    team,
                    &off,
                )
                .fetch_all(&mut *conn)
                .await
                .map_err(db)?;
                changes.extend(blocked.into_iter().map(|domain| {
                    MergeChange::new(
                        "crm",
                        "crm_blocked_domains",
                        json!({ "team_id": team, "domain": domain }),
                        Value::Null,
                    )
                }));
            }
        }

        // Its interaction dates span all of them, and sync's orphan cleanup
        // must not delete the domains the team chose to keep together.
        let previous = sqlx::query!(
            r#"WITH previous AS MATERIALIZED (
                   SELECT manually_created, first_interaction, last_interaction
                   FROM crm_companies WHERE id = $1
               ), span AS (
                   SELECT MIN(first_interaction) AS first_at, MAX(last_interaction) AS last_at
                   FROM crm_companies WHERE id = ANY($2) OR id = $1
               ), updated AS (
                   UPDATE crm_companies SET manually_created = TRUE,
                       first_interaction = (SELECT first_at FROM span),
                       last_interaction = (SELECT last_at FROM span),
                       updated_at = NOW()
                   WHERE id = $1
               )
               SELECT manually_created, first_interaction, last_interaction FROM previous"#,
            survivor,
            &sources,
        )
        .fetch_one(&mut *conn)
        .await
        .map_err(db)?;
        changes.push(MergeChange::new(
            "crm",
            "crm_companies",
            json!({ "id": survivor }),
            json!({
                "manually_created": previous.manually_created,
                "first_interaction": previous.first_interaction,
                "last_interaction": previous.last_interaction,
            }),
        ));

        // Ids merged into a merged company name the one that stays now, so
        // an old id never leads through two merges.
        let flattened = sqlx::query!(
            r#"WITH previous AS MATERIALIZED (
                   SELECT retired_id, company_id, merge_id FROM crm_company_aliases
                   WHERE company_id = ANY($2) FOR UPDATE
               ), updated AS (
                   UPDATE crm_company_aliases a SET company_id = $1
                   FROM previous WHERE a.retired_id = previous.retired_id
               )
               SELECT retired_id, company_id, merge_id FROM previous ORDER BY retired_id"#,
            survivor,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(flattened.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_company_aliases",
                json!({ "retired_id": row.retired_id }),
                json!({ "company_id": row.company_id, "merge_id": row.merge_id }),
            )
        }));
        sqlx::query!(
            r#"INSERT INTO crm_company_aliases (retired_id, company_id, merge_id)
               SELECT id, $1, $3 FROM UNNEST($2::uuid[]) AS retired(id)"#,
            survivor,
            &sources,
            merge_id,
        )
        .execute(&mut *conn)
        .await
        .map_err(db)?;

        Self::record_company_matching_change(&mut *conn, team, survivor).await?;
        for source in &sources {
            Self::record_company_matching_change(&mut *conn, team, *source).await?;
        }
        Self::invalidate_email_previews(&mut *conn, team).await?;
        Ok(changes)
    }

    /// Delete the merged companies, once every row that would cascade from
    /// them has moved. Their full rows go to the merge log.
    pub(crate) async fn delete_merged_companies(
        conn: &mut PgConnection,
        team: Uuid,
        sources: &[Uuid],
    ) -> Result<Vec<MergeChange>, MergeError> {
        let deleted = sqlx::query!(
            r#"DELETE FROM crm_companies c WHERE c.id = ANY($1) AND c.team_id = $2
               RETURNING c.id, to_jsonb(c.*) AS "row!""#,
            sources,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        if deleted.len() != sources.len() {
            return Err(MergeError::RecordUnavailable);
        }
        Ok(deleted
            .into_iter()
            .map(|row| MergeChange::new("crm", "crm_companies", json!({ "id": row.id }), row.row))
            .collect())
    }
}
