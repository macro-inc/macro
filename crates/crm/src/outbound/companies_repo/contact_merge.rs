//! A contact merge's own rows: the locks it takes, in the order every CRM
//! writer takes them; the state its review is built from; and the writes that
//! fold the merged contacts into the one that stays.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

use super::CompaniesRepositoryImpl;
use crate::domain::{
    model::CrmError,
    record_merge::{MergeError, MergeTargets, plan::MergingContact},
};
use crate::outbound::record_merge::MergeChange;

fn db(error: sqlx::Error) -> MergeError {
    MergeError::Crm(CrmError::StorageLayerError(error.into()))
}

/// A contact as the merge finds it.
#[derive(Debug, Clone)]
pub(crate) struct MergeContact {
    pub(crate) id: Uuid,
    /// Its own name, when it has one.
    pub(crate) own_name: Option<String>,
    /// As listings name it: its name, else its primary address.
    pub(crate) name: String,
    /// The company it is filed under, with that company's name.
    pub(crate) company: Option<(Uuid, String)>,
    /// Whether its company syncs mail; `true` without a company.
    pub(crate) syncs: bool,
    /// Every address it holds, lowercased: the primary first, then oldest.
    pub(crate) addresses: Vec<String>,
    /// The same addresses with when each was added, oldest first.
    pub(crate) added: Vec<(DateTime<Utc>, String)>,
}

/// What a contact merge's review is built from.
#[derive(Debug, Clone)]
pub(crate) struct ContactMergeState {
    pub(crate) survivor: MergeContact,
    /// In the targets' order.
    pub(crate) sources: Vec<MergeContact>,
}

impl ContactMergeState {
    /// The addresses each merged contact has now.
    pub(crate) fn source_addresses(&self) -> HashMap<Uuid, Vec<String>> {
        self.sources
            .iter()
            .map(|contact| (contact.id, contact.addresses.clone()))
            .collect()
    }

    /// The addresses the contact that stays has after the merge, in the
    /// order `fold_contacts` places them: its own first, then each address it
    /// lacks once, from the first merged contact by id holding it, ordered by
    /// when that contact added it, then by its bytes.
    pub(crate) fn addresses_after(&self) -> Vec<String> {
        let mut sources: Vec<&MergeContact> = self.sources.iter().collect();
        sources.sort_by_key(|contact| contact.id);
        let mut joining: Vec<(DateTime<Utc>, &str)> = Vec::new();
        for contact in sources {
            for (added, address) in &contact.added {
                if !self.survivor.addresses.contains(address)
                    && !joining.iter().any(|(_, joined)| joined == address)
                {
                    joining.push((*added, address));
                }
            }
        }
        joining.sort_unstable();
        let mut addresses = self.survivor.addresses.clone();
        addresses.extend(joining.into_iter().map(|(_, address)| address.to_owned()));
        addresses
    }

    /// The contacts as the company rule reads them.
    pub(crate) fn merging(&self) -> (MergingContact, Vec<MergingContact>) {
        let merging = |contact: &MergeContact| MergingContact {
            contact_id: contact.id,
            name: contact.own_name.clone(),
            company: contact.company.clone(),
            addresses: contact.addresses.clone(),
        };
        (
            merging(&self.survivor),
            self.sources.iter().map(merging).collect(),
        )
    }
}

impl CompaniesRepositoryImpl {
    /// Take the merge's CRM locks: the exclusive privacy lock, which holds
    /// off email population and contact edits, the lock of every address's
    /// domain in order, the team, then the contacts in id order. Returns the
    /// contacts' state, read under those locks.
    #[tracing::instrument(name = "crm.merge.lock_contacts", skip_all, fields(team_id = %team, contacts = targets.all_sorted().len()), err)]
    pub(crate) async fn lock_contact_merge(
        conn: &mut PgConnection,
        team: Uuid,
        targets: &MergeTargets,
    ) -> Result<ContactMergeState, MergeError> {
        Self::lock_email_privacy(&mut *conn, team, true).await?;
        // Address and archive writers hold the privacy lock, so these
        // addresses and flags stay as read until commit.
        let state = Self::contact_merge_state(&mut *conn, team, targets).await?;
        let mut domains: Vec<&str> = std::iter::once(&state.survivor)
            .chain(&state.sources)
            .flat_map(|contact| contact.addresses.iter())
            .filter_map(|address| address.rsplit_once('@').map(|(_, domain)| domain))
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

        // The contacts were found in the team above; lock exactly them.
        let ids = targets.all_sorted();
        let locked = sqlx::query_scalar!(
            "SELECT id FROM crm_contacts WHERE id = ANY($1) ORDER BY id FOR UPDATE",
            &ids,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        if locked.len() != ids.len() {
            return Err(MergeError::RecordUnavailable);
        }
        Self::contact_merge_state(conn, team, targets).await
    }

    /// The contacts of a merge as they are now. A contact merged away earlier
    /// is named by its current one; anything else missing, in another team,
    /// archived, or under an archived company is refused.
    pub(crate) async fn contact_merge_state(
        conn: &mut PgConnection,
        team: Uuid,
        targets: &MergeTargets,
    ) -> Result<ContactMergeState, MergeError> {
        let ids = targets.all_sorted();
        // Probe each id by its key before the team filter, so stale
        // statistics can't turn this into a team scan.
        let rows = sqlx::query!(
            r#"SELECT ct.id AS "id!", ct.name, ct.email, ct.company_id,
                      ct.hidden OR COALESCE(co.hidden, FALSE) AS "hidden!",
                      COALESCE(co.email_sync, TRUE) AS "syncs!",
                      COALESCE(co.custom_name, primary_domain.name, primary_domain.domain, 'Unnamed company') AS "company_name!"
               FROM UNNEST($1::uuid[]) AS wanted(id)
               CROSS JOIN LATERAL (
                   SELECT id, team_id, company_id, name, email, hidden FROM crm_contacts
                   WHERE id = wanted.id OFFSET 0
               ) ct
               LEFT JOIN crm_companies co ON co.id = ct.company_id
               LEFT JOIN LATERAL (
                   SELECT pd.domain, dd.name
                   FROM crm_domains pd
                   LEFT JOIN crm_domain_directory dd ON LOWER(dd.domain) = LOWER(pd.domain)
                   WHERE pd.company_id = ct.company_id
                   ORDER BY pd.created_at, pd.id
                   LIMIT 1
               ) primary_domain ON TRUE
               WHERE ct.team_id = $2"#,
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
                r#"SELECT a.retired_id, a.contact_id
                   FROM crm_contact_aliases a
                   JOIN crm_contacts ct ON ct.id = a.contact_id
                   WHERE a.retired_id = ANY($1) AND ct.team_id = $2
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
                    current_id: alias.contact_id,
                },
                None => MergeError::RecordUnavailable,
            });
        }
        if let Some(hidden) = rows.iter().find(|row| row.hidden) {
            return Err(MergeError::RecordHidden(hidden.id));
        }

        let addresses = sqlx::query!(
            r#"SELECT e.contact_id, LOWER(e.email) AS "email!", e.created_at
               FROM crm_contact_emails e
               WHERE e.contact_id = ANY($1)
               ORDER BY e.contact_id, e.created_at, LOWER(e.email)"#,
            &targets.all_sorted(),
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        let mut by_contact: HashMap<Uuid, Vec<(DateTime<Utc>, String)>> = HashMap::new();
        for row in addresses {
            by_contact
                .entry(row.contact_id)
                .or_default()
                .push((row.created_at, row.email));
        }
        let contact = |id: Uuid| -> Result<MergeContact, MergeError> {
            let row = rows
                .iter()
                .find(|row| row.id == id)
                .ok_or(MergeError::RecordUnavailable)?;
            let primary = row.email.as_deref().map(str::to_lowercase);
            let added = by_contact.get(&id).cloned().unwrap_or_default();
            let mut held: Vec<String> = added.iter().map(|(_, address)| address.clone()).collect();
            if let Some(primary) = &primary {
                held.retain(|address| address != primary);
                held.insert(0, primary.clone());
            }
            Ok(MergeContact {
                id,
                own_name: row.name.clone(),
                name: row
                    .name
                    .clone()
                    .or_else(|| row.email.clone())
                    .unwrap_or_else(|| "Unnamed contact".into()),
                company: row
                    .company_id
                    .map(|company| (company, row.company_name.clone())),
                syncs: row.syncs,
                addresses: held,
                added,
            })
        };

        Ok(ContactMergeState {
            survivor: contact(targets.survivor())?,
            sources: targets
                .sources()
                .iter()
                .copied()
                .map(contact)
                .collect::<Result<_, _>>()?,
        })
    }

    /// Fold the merged contacts into the one that stays: their addresses join
    /// it after its own (its primary address stays), an address it already
    /// holds collapses, their mailbox sources move to it once per mailbox,
    /// its interaction dates span all of them, and their old ids name it. The
    /// merged contacts are deleted last, once nothing that cascades from them
    /// is left. Every changed row is returned as it was.
    #[tracing::instrument(name = "crm.merge.fold_contacts", skip_all, fields(team_id = %team, %merge_id), err)]
    pub(crate) async fn fold_contacts(
        conn: &mut PgConnection,
        team: Uuid,
        merge_id: Uuid,
        state: &ContactMergeState,
    ) -> Result<Vec<MergeChange>, MergeError> {
        let survivor = state.survivor.id;
        let sources: Vec<Uuid> = state.sources.iter().map(|contact| contact.id).collect();
        let mut changes = Vec::new();

        // One row per address the survivor lacks, from the first source (by
        // id) holding it; the rest go with the merged contacts.
        let addresses = sqlx::query!(
            r#"WITH moving AS MATERIALIZED (
                   SELECT DISTINCT ON (LOWER(e.email)) e.contact_id, e.email, e.created_at
                   FROM crm_contact_emails e
                   WHERE e.contact_id = ANY($2)
                     AND NOT EXISTS (
                         SELECT 1 FROM crm_contact_emails held
                         WHERE held.contact_id = $1 AND LOWER(held.email) = LOWER(e.email)
                     )
                   ORDER BY LOWER(e.email), e.contact_id
               ), placed AS (
                   SELECT contact_id, email, created_at,
                          row_number() OVER (ORDER BY created_at, email COLLATE "C") AS place
                   FROM moving
               ), after AS (
                   SELECT GREATEST(clock_timestamp(), MAX(created_at)) AS at
                   FROM crm_contact_emails WHERE contact_id = $1
               ), moved AS (
                   UPDATE crm_contact_emails e
                   SET contact_id = $1,
                       created_at = (SELECT at FROM after) + placed.place * INTERVAL '1 microsecond'
                   FROM placed
                   WHERE e.contact_id = placed.contact_id AND e.email = placed.email
                   RETURNING e.email
               )
               SELECT placed.contact_id, placed.email, placed.created_at
               FROM placed JOIN moved USING (email) ORDER BY placed.place"#,
            survivor,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(addresses.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contact_emails",
                json!({ "contact_id": survivor, "email": row.email }),
                json!({ "contact_id": row.contact_id, "created_at": row.created_at }),
            )
        }));

        // One source per mailbox: a mailbox the survivor already counts, or
        // that several merged contacts share, keeps a single row.
        let mailboxes = sqlx::query!(
            r#"WITH moving AS MATERIALIZED (
                   SELECT DISTINCT ON (s.link_id) s.id, s.contact_id
                   FROM crm_contact_sources s
                   WHERE s.contact_id = ANY($2)
                     AND NOT EXISTS (
                         SELECT 1 FROM crm_contact_sources held
                         WHERE held.contact_id = $1 AND held.link_id = s.link_id
                     )
                   ORDER BY s.link_id, s.created_at, s.id
               ), moved AS (
                   UPDATE crm_contact_sources s SET contact_id = $1
                   FROM moving WHERE s.id = moving.id
                   RETURNING s.id
               )
               SELECT moving.id, moving.contact_id FROM moving JOIN moved USING (id)
               ORDER BY moving.id"#,
            survivor,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(mailboxes.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contact_sources",
                json!({ "id": row.id }),
                json!({ "contact_id": row.contact_id }),
            )
        }));

        // What stays behind goes with the merged contacts; the log keeps it.
        let collapsed_addresses = sqlx::query!(
            r#"SELECT e.contact_id, e.email, e.created_at FROM crm_contact_emails e
               WHERE e.contact_id = ANY($1) ORDER BY e.contact_id, e.email"#,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(collapsed_addresses.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contact_emails",
                json!({ "contact_id": row.contact_id, "email": row.email }),
                json!({ "created_at": row.created_at }),
            )
        }));
        let collapsed_mailboxes = sqlx::query!(
            r#"SELECT s.id, s.contact_id, s.link_id, s.created_at FROM crm_contact_sources s
               WHERE s.contact_id = ANY($1) ORDER BY s.id"#,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(collapsed_mailboxes.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contact_sources",
                json!({ "id": row.id }),
                json!({ "contact_id": row.contact_id, "link_id": row.link_id, "created_at": row.created_at }),
            )
        }));

        // Its interaction dates span all of them, and email cleanup must not
        // delete the person the team chose to keep together.
        let previous = sqlx::query!(
            r#"WITH previous AS MATERIALIZED (
                   SELECT manually_created, first_interaction, last_interaction
                   FROM crm_contacts WHERE id = $1
               ), span AS (
                   SELECT MIN(first_interaction) AS first_at, MAX(last_interaction) AS last_at
                   FROM crm_contacts WHERE id = ANY($2) OR id = $1
               ), updated AS (
                   UPDATE crm_contacts SET manually_created = TRUE,
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
            "crm_contacts",
            json!({ "id": survivor }),
            json!({
                "manually_created": previous.manually_created,
                "first_interaction": previous.first_interaction,
                "last_interaction": previous.last_interaction,
            }),
        ));

        // Ids merged into a merged contact name the one that stays now, so
        // an old id never leads through two merges.
        let flattened = sqlx::query!(
            r#"WITH previous AS MATERIALIZED (
                   SELECT retired_id, contact_id, merge_id FROM crm_contact_aliases
                   WHERE contact_id = ANY($2) FOR UPDATE
               ), updated AS (
                   UPDATE crm_contact_aliases a SET contact_id = $1
                   FROM previous WHERE a.retired_id = previous.retired_id
               )
               SELECT retired_id, contact_id, merge_id FROM previous ORDER BY retired_id"#,
            survivor,
            &sources,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(flattened.into_iter().map(|row| {
            MergeChange::new(
                "crm",
                "crm_contact_aliases",
                json!({ "retired_id": row.retired_id }),
                json!({ "contact_id": row.contact_id, "merge_id": row.merge_id }),
            )
        }));
        let aliased = sqlx::query_scalar!(
            r#"INSERT INTO crm_contact_aliases (retired_id, contact_id, merge_id)
               SELECT id, $1, $3 FROM UNNEST($2::uuid[]) AS retired(id)
               RETURNING retired_id"#,
            survivor,
            &sources,
            merge_id,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        changes.extend(aliased.into_iter().map(|retired_id| {
            MergeChange::new(
                "crm",
                "crm_contact_aliases",
                json!({ "retired_id": retired_id }),
                Value::Null,
            )
        }));

        Self::record_contact_matching_change(&mut *conn, team, survivor).await?;
        for source in &sources {
            Self::record_contact_matching_change(&mut *conn, team, *source).await?;
        }
        Self::invalidate_email_previews(&mut *conn, team).await?;
        Ok(changes)
    }

    /// Delete the merged contacts, once every row that would cascade from
    /// them has moved; their full rows go to the merge log. A contact that
    /// stays without a primary address then takes its oldest, as removing a
    /// primary does: only now is no merged contact holding it as theirs.
    pub(crate) async fn delete_merged_contacts(
        conn: &mut PgConnection,
        team: Uuid,
        survivor: Uuid,
        sources: &[Uuid],
    ) -> Result<Vec<MergeChange>, MergeError> {
        let deleted = sqlx::query!(
            r#"DELETE FROM crm_contacts ct WHERE ct.id = ANY($1) AND ct.team_id = $2
               RETURNING ct.id, to_jsonb(ct.*) AS "row!""#,
            sources,
            team,
        )
        .fetch_all(&mut *conn)
        .await
        .map_err(db)?;
        if deleted.len() != sources.len() {
            return Err(MergeError::RecordUnavailable);
        }
        let mut changes: Vec<MergeChange> = deleted
            .into_iter()
            .map(|row| MergeChange::new("crm", "crm_contacts", json!({ "id": row.id }), row.row))
            .collect();
        let promoted = sqlx::query_scalar!(
            r#"UPDATE crm_contacts ct SET email = (
                   SELECT e.email FROM crm_contact_emails e
                   WHERE e.contact_id = ct.id ORDER BY e.created_at, e.email LIMIT 1
               )
               WHERE ct.id = $1 AND ct.email IS NULL
                 AND EXISTS (SELECT 1 FROM crm_contact_emails e WHERE e.contact_id = ct.id)
               RETURNING ct.id"#,
            survivor,
        )
        .fetch_optional(&mut *conn)
        .await
        .map_err(db)?;
        if promoted.is_some() {
            changes.push(MergeChange::new(
                "crm",
                "crm_contacts",
                json!({ "id": survivor }),
                json!({ "email": Value::Null }),
            ));
        }
        Ok(changes)
    }
}
