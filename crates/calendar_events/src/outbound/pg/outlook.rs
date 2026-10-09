//! Outlook calendar leases are fenced by both mailbox custody and grant generation.
mod automatic_decline;
use super::*;
use crate::domain::models::ProviderCalendarTarget;
use crate::domain::outlook::*;
use crate::domain::ports::CalendarProviderErrorKind;

pub(super) async fn fence_binding(
    tx: &mut Transaction<'_, Postgres>,
    binding: CalendarGrantBinding,
) -> Result<(), Report> {
    let row=sqlx::query!(r#"SELECT l.id FROM email_links l JOIN email_link_microsoft_scopes s ON s.link_id=l.id AND s.grant_generation=l.grant_generation
        WHERE l.id=$1 AND l.provider='OUTLOOK' AND l.is_sync_active AND l.sync_generation=$2 AND l.grant_generation=$3
        AND s.calendar_disabled_at IS NULL AND s.granted_scopes @> ARRAY['Calendars.ReadWrite']::text[] FOR UPDATE OF l,s"#,
        binding.link_id,binding.sync_generation,binding.grant_generation).fetch_optional(&mut **tx).await.map_err(report)?;
    if row.is_none() {
        return Err(rootcause::report!(
            "Microsoft calendar binding is no longer active"
        ));
    }
    Ok(())
}

impl CalendarProjectionOutbox for PgCalendarRepository {
    async fn claim_projection(
        &self,
        lease_id: Uuid,
    ) -> Result<Option<CalendarProjectionLease>, Report> {
        let row=sqlx::query!(r#"WITH candidate AS(SELECT event_id FROM calendar_projection_outbox WHERE next_run_at<=now() AND(lease_until IS NULL OR lease_until<now())
            ORDER BY next_run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
            UPDATE calendar_projection_outbox o SET lease_id=$1,lease_until=now()+interval '2 minutes' FROM candidate c WHERE o.event_id=c.event_id
            RETURNING o.event_id,o.owner_id,o.link_id,o.change_kind,o.revision"#,lease_id).fetch_optional(&self.pool).await.map_err(report)?;
        row.map(|r| {
            use crate::domain::events::{CalendarEventMetadata, CalendarTopicEvent};
            let metadata = CalendarEventMetadata {
                event_id: r.event_id,
                owner_id: r.owner_id,
            };
            let event = match r.change_kind.as_str() {
                "created" => CalendarTopicEvent::Created(metadata),
                "updated" => CalendarTopicEvent::Updated(metadata),
                "deleted" => CalendarTopicEvent::Deleted(metadata),
                _ => return Err(rootcause::report!("invalid calendar journal change")),
            };
            Ok(CalendarProjectionLease {
                event_id: r.event_id,
                revision: r.revision,
                lease_id,
                link_id: r.link_id,
                event,
            })
        })
        .transpose()
    }
    async fn complete_projection(&self, lease: &CalendarProjectionLease) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        sqlx::query!("DELETE FROM calendar_projection_outbox WHERE event_id=$1 AND lease_id=$2 AND revision=$3",lease.event_id,lease.lease_id,lease.revision).execute(&mut *tx).await.map_err(report)?;
        sqlx::query!("UPDATE calendar_projection_outbox SET lease_id=NULL,lease_until=NULL WHERE event_id=$1 AND lease_id=$2",lease.event_id,lease.lease_id).execute(&mut *tx).await.map_err(report)?;
        tx.commit().await.map_err(report)
    }
}

pub(super) async fn fence(
    tx: &mut Transaction<'_, Postgres>,
    lease: &OutlookCalendarLease,
) -> Result<(), Report> {
    fence_binding(tx, lease.binding).await?;
    let row=sqlx::query!(r#"SELECT w.id FROM calendar_outlook_work w JOIN calendar_accounts a ON a.id=w.account_id
        WHERE w.id=$1 AND w.lease_id=$2 AND w.lease_until>now() AND w.sync_generation=$3 AND w.grant_generation=$4 AND a.email_link_id=$5
        AND a.id=$6 AND a.sync_status NOT IN ('disabled','reauth_required') FOR UPDATE OF w"#,
        lease.id,lease.lease_id,lease.binding.sync_generation,lease.binding.grant_generation,lease.binding.link_id,lease.account_id).fetch_optional(&mut **tx).await.map_err(report)?;
    if row.is_none() {
        return Err(rootcause::report!(
            "Microsoft calendar lease is no longer active"
        ));
    }
    Ok(())
}

async fn retire_sources(
    tx: &mut Transaction<'_, Postgres>,
    log: &mut ChangeLogBatch,
    calendar_id: Uuid,
    observed: &[String],
) -> Result<(), Report> {
    let ids=sqlx::query_scalar!(r#"WITH removed AS(DELETE FROM calendar_event_sources WHERE source_kind='outlook' AND calendar_id=$1 AND NOT(provider_event_id=ANY($2::text[])) RETURNING event_id)
        SELECT DISTINCT event_id AS "event_id!" FROM removed"#,calendar_id,observed).fetch_all(&mut **tx).await.map_err(report)?;
    for id in ids {
        restore_best_source_or_delete(tx, log, id).await?;
    }
    Ok(())
}

impl OutlookCalendarRepository for PgCalendarRepository {
    async fn checkpoint_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        progress: OutlookCalendarProgress,
    ) -> Result<(), Report> {
        let target = lease
            .target
            .as_ref()
            .ok_or_else(|| rootcause::report!("calendar checkpoint requires an event stream"))?;
        let mut tx = self.pool.begin().await.map_err(report)?;
        let mut log = ChangeLogBatch::default();
        fence(&mut tx, lease).await?;
        let state=sqlx::query!("SELECT scan_id,full_scan,page_loaded,page_cursor,next_page,terminal_cursor,pending_ids,visited_pages FROM calendar_outlook_work WHERE id=$1",lease.id).fetch_one(&mut *tx).await.map_err(report)?;
        let mut delay = false;
        match progress {
            OutlookCalendarProgress::Reset => reset_cursor(&mut tx, lease.id).await?,
            OutlookCalendarProgress::Page(page) => {
                if state.page_loaded || !state.pending_ids.is_empty() {
                    return Err(rootcause::report!(
                        "calendar page still has unacknowledged work"
                    ));
                }
                if page.next.as_ref().is_some_and(|next| {
                    state.visited_pages.contains(next) || state.page_cursor.as_ref() == Some(next)
                }) {
                    return Err(rootcause::report!("Microsoft calendar pagination loop"));
                }
                let removed = sqlx::query!(
                    r#"SELECT DISTINCT requested.id AS "requested!",m.master_id AS "master_id?"
                    FROM unnest($2::text[]) requested(id) LEFT JOIN calendar_outlook_members m
                    ON m.work_id=$1 AND(m.provider_id=requested.id OR m.master_id=requested.id)"#,
                    lease.id,
                    &page.removed
                )
                .fetch_all(&mut *tx)
                .await
                .map_err(report)?;
                if !state.full_scan && removed.iter().any(|m| m.master_id.is_none()) {
                    // A tombstone without an observed occurrence/master binding
                    // cannot safely identify what to retire. Reconcile the view.
                    reset_cursor(&mut tx, lease.id).await?;
                } else {
                    let (ids, masters): (Vec<_>, Vec<_>) = page
                        .members
                        .into_iter()
                        .collect::<std::collections::BTreeMap<_, _>>()
                        .into_iter()
                        .unzip();
                    sqlx::query!(r#"INSERT INTO calendar_outlook_members(work_id,provider_id,master_id,scan_id)
                        SELECT $1,rows.id,rows.master,$4 FROM unnest($2::text[],$3::text[]) rows(id,master)
                        ON CONFLICT(work_id,provider_id) DO UPDATE SET master_id=EXCLUDED.master_id,scan_id=EXCLUDED.scan_id"#,
                        lease.id,&ids,&masters,state.scan_id).execute(&mut *tx).await.map_err(report)?;
                    let pending: Vec<_> = masters
                        .into_iter()
                        .chain(removed.into_iter().filter_map(|r| r.master_id))
                        .collect::<std::collections::BTreeSet<_>>()
                        .into_iter()
                        .collect();
                    sqlx::query!("DELETE FROM calendar_outlook_members WHERE work_id=$1 AND(provider_id=ANY($2::text[]) OR master_id=ANY($2::text[]))",lease.id,&page.removed).execute(&mut *tx).await.map_err(report)?;
                    sqlx::query!(r#"UPDATE calendar_outlook_work SET page_loaded=true,pending_ids=$2,next_page=$3,terminal_cursor=$4,
                        visited_pages=array_append(visited_pages,COALESCE(page_cursor,'initial')) WHERE id=$1"#,lease.id,&pending,page.next,page.delta).execute(&mut *tx).await.map_err(report)?;
                }
            }
            OutlookCalendarProgress::Event { id, exists } => {
                if state.pending_ids.first() != Some(&id) || !state.page_loaded {
                    return Err(rootcause::report!(
                        "calendar event acknowledgment does not match pending work"
                    ));
                }
                if !exists {
                    let ids=sqlx::query_scalar!("DELETE FROM calendar_event_sources WHERE source_kind='outlook' AND calendar_id=$1 AND provider_event_id=$2 RETURNING event_id",target.calendar_id,&id).fetch_all(&mut *tx).await.map_err(report)?;
                    for id in ids {
                        restore_best_source_or_delete(&mut tx, &mut log, id).await?;
                    }
                    sqlx::query!(
                        "DELETE FROM calendar_outlook_members WHERE work_id=$1 AND master_id=$2",
                        lease.id,
                        &id
                    )
                    .execute(&mut *tx)
                    .await
                    .map_err(report)?;
                }
                sqlx::query!("UPDATE calendar_outlook_work SET pending_ids=array_remove(pending_ids,$2) WHERE id=$1",lease.id,&id).execute(&mut *tx).await.map_err(report)?;
            }
            OutlookCalendarProgress::Finish => {
                if !state.pending_ids.is_empty() || !state.page_loaded {
                    return Err(rootcause::report!(
                        "calendar round still has unacknowledged work"
                    ));
                }
                if let Some(next) = state.next_page {
                    sqlx::query!("UPDATE calendar_outlook_work SET page_cursor=$2,next_page=NULL,page_loaded=false WHERE id=$1",lease.id,next).execute(&mut *tx).await.map_err(report)?;
                } else {
                    if lease.is_primary && state.terminal_cursor.is_none() {
                        return Err(rootcause::report!(
                            "primary calendar round is missing its terminal delta cursor"
                        ));
                    }
                    if state.full_scan {
                        let observed=sqlx::query_scalar!("SELECT DISTINCT master_id FROM calendar_outlook_members WHERE work_id=$1 AND scan_id=$2",lease.id,state.scan_id).fetch_all(&mut *tx).await.map_err(report)?;
                        retire_sources(&mut tx, &mut log, target.calendar_id, &observed).await?;
                        sqlx::query!(
                            "DELETE FROM calendar_outlook_members WHERE work_id=$1 AND scan_id<>$2",
                            lease.id,
                            state.scan_id
                        )
                        .execute(&mut *tx)
                        .await
                        .map_err(report)?;
                    }
                    sqlx::query!(r#"UPDATE calendar_outlook_work SET cursor=$2,page_cursor=$2,terminal_cursor=NULL,page_loaded=false,full_scan=$3,scan_id=gen_random_uuid(),visited_pages='{}'
                        WHERE id=$1"#,lease.id,if lease.is_primary{state.terminal_cursor}else{None},!lease.is_primary).execute(&mut *tx).await.map_err(report)?;
                    sqlx::query!(r#"UPDATE calendars SET synced_at=now(),last_sync_error=NULL,last_sync_error_at=NULL,consecutive_sync_failures=0,
                        materialized_starts_at=$2,materialized_ends_at=$3,materialized_start_date=$4,materialized_end_date=$5 WHERE id=$1"#,
                        target.calendar_id,target.range.starts_at,target.range.ends_at,target.range.start_date,target.range.end_date).execute(&mut *tx).await.map_err(report)?;
                    sqlx::query!(r#"UPDATE calendar_accounts a SET sync_status=CASE WHEN EXISTS(SELECT 1 FROM calendars c WHERE c.account_id=a.id AND NOT c.is_deleted AND c.synced_at IS NULL) THEN 'syncing' ELSE 'ready' END,
                        last_synced_at=now(),last_sync_error=NULL WHERE a.id=$1"#,lease.account_id).execute(&mut *tx).await.map_err(report)?;
                    delay = true;
                }
            }
        }
        sqlx::query!("UPDATE calendar_outlook_work SET lease_id=NULL,lease_until=NULL,next_run_at=now()+make_interval(secs=>CASE WHEN $2 THEN 120 ELSE 0 END),last_error=NULL,attempts=0 WHERE id=$1",lease.id,delay).execute(&mut *tx).await.map_err(report)?;
        log.commit(tx).await
    }
    async fn claim_outlook_calendar(
        &self,
        lease_id: Uuid,
        range: OccurrenceRange,
    ) -> Result<Option<OutlookCalendarLease>, Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        let mut log = ChangeLogBatch::default();
        // Capability discovery is idempotent. Mail and authentication own the
        // grants; calendar consumes only their non-secret current projection.
        let disabled=sqlx::query!(r#"SELECT a.email_link_id FROM calendar_accounts a JOIN email_links l ON l.id=a.email_link_id
            WHERE a.provider='outlook' AND a.sync_status<>'disabled' AND NOT EXISTS(
                SELECT 1 FROM email_link_microsoft_scopes s WHERE s.link_id=l.id AND s.grant_generation=l.grant_generation AND l.is_sync_active
                    AND s.calendar_disabled_at IS NULL AND s.granted_scopes @> ARRAY['Calendars.ReadWrite']::text[])
            FOR UPDATE OF l SKIP LOCKED"#).fetch_all(&mut *tx).await.map_err(report)?;
        for row in disabled {
            disable_calendar_capability_tx(&mut tx, &mut log, row.email_link_id).await?;
        }
        sqlx::query!(r#"INSERT INTO calendar_accounts(id,owner_id,email_link_id,provider,provider_account_id)
            SELECT gen_random_uuid(),l.macro_id,l.id,'outlook',l.email_address::text FROM email_links l
            JOIN email_link_microsoft_scopes s ON s.link_id=l.id AND s.grant_generation=l.grant_generation
            WHERE l.provider='OUTLOOK' AND l.is_sync_active AND s.calendar_disabled_at IS NULL AND s.granted_scopes @> ARRAY['Calendars.ReadWrite']::text[]
            ON CONFLICT(email_link_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,
                sync_status=CASE WHEN calendar_accounts.sync_status='disabled' THEN 'pending' ELSE calendar_accounts.sync_status END
            WHERE calendar_accounts.owner_id<>EXCLUDED.owner_id OR calendar_accounts.sync_status='disabled'"#).execute(&mut *tx).await.map_err(report)?;
        sqlx::query!(r#"INSERT INTO calendar_outlook_work(id,account_id,sync_generation,grant_generation,starts_at,ends_at)
            SELECT gen_random_uuid(),a.id,l.sync_generation,l.grant_generation,$1,$2 FROM calendar_accounts a JOIN email_links l ON l.id=a.email_link_id
            WHERE a.provider='outlook' AND a.sync_status<>'disabled' AND l.is_sync_active
            ON CONFLICT(account_id) WHERE calendar_id IS NULL DO NOTHING"#,range.starts_at,range.ends_at).execute(&mut *tx).await.map_err(report)?;
        // A replacement grant is the only automatic exit from reauthorization.
        sqlx::query!(r#"UPDATE calendar_accounts a SET sync_status='pending',last_sync_error=NULL
            FROM email_links l WHERE l.id=a.email_link_id AND a.provider='outlook' AND a.sync_status='reauth_required'
            AND l.is_sync_active AND EXISTS(SELECT 1 FROM calendar_outlook_work w WHERE w.account_id=a.id
                AND(w.sync_generation<>l.sync_generation OR w.grant_generation<>l.grant_generation))"#)
            .execute(&mut *tx).await.map_err(report)?;
        // Replacement credentials invalidate every old lease and cursor. Sliding
        // windows only advance on month boundaries, never on each poll.
        sqlx::query!(r#"UPDATE calendar_outlook_work w SET sync_generation=l.sync_generation,grant_generation=l.grant_generation,
            cursor=NULL,page_cursor=NULL,next_page=NULL,terminal_cursor=NULL,pending_ids='{}',visited_pages='{}',scan_id=gen_random_uuid(),full_scan=true,page_loaded=false,starts_at=$1,ends_at=$2,lease_id=NULL,lease_until=NULL,next_run_at=now(),attempts=0
            FROM calendar_accounts a,email_links l WHERE a.id=w.account_id AND l.id=a.email_link_id AND l.is_sync_active
            AND a.provider='outlook' AND a.sync_status<>'disabled'
            AND(w.sync_generation<>l.sync_generation OR w.grant_generation<>l.grant_generation OR w.ends_at<$2)"#,range.starts_at,range.ends_at).execute(&mut *tx).await.map_err(report)?;
        let row=sqlx::query!(r#"WITH candidate AS(SELECT w.id FROM calendar_outlook_work w JOIN calendar_accounts a ON a.id=w.account_id
            JOIN email_links l ON l.id=a.email_link_id JOIN email_link_microsoft_scopes s ON s.link_id=l.id AND s.grant_generation=l.grant_generation
            LEFT JOIN calendars c ON c.id=w.calendar_id
            WHERE l.is_sync_active AND a.provider='outlook' AND a.sync_status NOT IN ('disabled','reauth_required') AND s.calendar_disabled_at IS NULL AND s.granted_scopes @> ARRAY['Calendars.ReadWrite']::text[]
              AND(w.calendar_id IS NULL OR NOT c.is_deleted) AND w.next_run_at<=now() AND(w.lease_until IS NULL OR w.lease_until<now())
            ORDER BY w.next_run_at,w.calendar_id NULLS FIRST LIMIT 1 FOR UPDATE OF w SKIP LOCKED)
            UPDATE calendar_outlook_work w SET lease_id=$1,lease_until=now()+interval '3 minutes'
            FROM candidate,calendar_accounts a,email_links l WHERE w.id=candidate.id AND a.id=w.account_id AND l.id=a.email_link_id
            RETURNING w.id,w.account_id,w.calendar_id,w.sync_generation,w.grant_generation,w.cursor,w.starts_at,w.ends_at,w.pending_ids,w.page_loaded,w.page_cursor,a.owner_id,l.id AS link_id,l.email_address::text AS "email_address!",l.fusionauth_user_id"#,lease_id).fetch_optional(&mut *tx).await.map_err(report)?;
        let Some(row) = row else {
            log.commit(tx).await?;
            return Ok(None);
        };
        let binding = CalendarGrantBinding {
            link_id: row.link_id,
            sync_generation: row.sync_generation,
            grant_generation: row.grant_generation,
        };
        let token_identity = CalendarLinkTokenIdentity {
            binding: Some(binding),
            fusionauth_user_id: row.fusionauth_user_id,
            email_address: row.email_address,
            provider: CalendarProvider::Outlook,
        };
        let (target, is_primary) = if let Some(id) = row.calendar_id {
            let c = sqlx::query!(
                "SELECT provider_calendar_id,access_role,is_primary FROM calendars WHERE id=$1",
                id
            )
            .fetch_one(&mut *tx)
            .await
            .map_err(report)?;
            (
                Some(ProviderCalendarTarget {
                    binding: Some(binding),
                    provider: CalendarProvider::Outlook,
                    owner_id: row.owner_id.clone(),
                    email_link_id: row.link_id,
                    account_id: row.account_id,
                    calendar_id: id,
                    provider_calendar_id: c.provider_calendar_id,
                    is_read_only: !matches!(c.access_role.as_deref(), Some("writer" | "owner")),
                    observed_access_role: c.access_role,
                    range: OccurrenceRange {
                        starts_at: row.starts_at,
                        ends_at: row.ends_at,
                        start_date: row.starts_at.date_naive(),
                        end_date: row.ends_at.date_naive(),
                    },
                }),
                c.is_primary,
            )
        } else {
            (None, false)
        };
        sqlx::query!("UPDATE calendar_accounts SET sync_status=CASE WHEN last_synced_at IS NULL OR sync_status='reauth_required' THEN 'syncing' ELSE sync_status END WHERE id=$1",row.account_id).execute(&mut *tx).await.map_err(report)?;
        log.commit(tx).await?;
        Ok(Some(OutlookCalendarLease {
            id: row.id,
            lease_id,
            binding,
            account_id: row.account_id,
            owner_id: row.owner_id,
            token_identity,
            target,
            is_primary,
            cursor: row.cursor,
            pending_ids: row.pending_ids,
            page_loaded: row.page_loaded,
            page_cursor: row.page_cursor,
        }))
    }
    async fn renew_outlook_calendar(&self, lease: &OutlookCalendarLease) -> Result<(), Report> {
        let mut tx = self.pool.begin().await.map_err(report)?;
        fence(&mut tx, lease).await?;
        sqlx::query!(
            "UPDATE calendar_outlook_work SET lease_until=now()+interval '3 minutes' WHERE id=$1",
            lease.id
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        tx.commit().await.map_err(report)
    }
    async fn commit_outlook_calendars(
        &self,
        lease: &OutlookCalendarLease,
        calendars: Vec<OutlookCalendar>,
    ) -> Result<(), Report> {
        if lease.target.is_some() {
            return Err(rootcause::report!(
                "calendar discovery requires an account lease"
            ));
        }
        let mut tx = self.pool.begin().await.map_err(report)?;
        let mut log = ChangeLogBatch::default();
        fence(&mut tx, lease).await?;
        let mut observed = vec![];
        let range = OccurrenceRange::maintenance_horizon(Utc::now());
        for calendar in calendars {
            observed.push(calendar.calendar.provider_calendar_id.clone());
            let c = upsert_calendar_tx(
                &mut tx,
                &mut log,
                lease.binding.link_id,
                lease.account_id,
                calendar.calendar,
                Some(CalendarProvider::Outlook),
            )
            .await?;
            sqlx::query!(
                "UPDATE calendars SET online_meeting_providers=$2 WHERE id=$1",
                c.id,
                &calendar.online_meeting_providers
            )
            .execute(&mut *tx)
            .await
            .map_err(report)?;
            sqlx::query!(r#"INSERT INTO calendar_outlook_work(id,account_id,calendar_id,sync_generation,grant_generation,starts_at,ends_at)
                VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(account_id,calendar_id) WHERE calendar_id IS NOT NULL DO NOTHING"#,
                Uuid::now_v7(),lease.account_id,c.id,lease.binding.sync_generation,lease.binding.grant_generation,range.starts_at,range.ends_at).execute(&mut *tx).await.map_err(report)?;
        }
        let removed=sqlx::query!("UPDATE calendars SET is_deleted=true WHERE account_id=$1 AND NOT(provider_calendar_id=ANY($2::text[])) AND NOT is_deleted RETURNING id",lease.account_id,&observed).fetch_all(&mut *tx).await.map_err(report)?;
        for c in removed {
            retire_sources(&mut tx, &mut log, c.id, &[]).await?;
        }
        sqlx::query!("UPDATE calendar_outlook_work SET lease_id=NULL,lease_until=NULL,next_run_at=now()+interval '5 minutes',attempts=0,last_error=NULL WHERE id=$1",lease.id).execute(&mut *tx).await.map_err(report)?;
        if observed.is_empty() {
            sqlx::query!("UPDATE calendar_accounts SET sync_status='ready',last_synced_at=now(),last_sync_error=NULL WHERE id=$1",lease.account_id).execute(&mut *tx).await.map_err(report)?;
        }
        log.commit(tx).await
    }
    #[cfg(test)]
    async fn commit_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        observed: Option<Vec<String>>,
        cursor: Option<String>,
    ) -> Result<(), Report> {
        let target = lease
            .target
            .as_ref()
            .ok_or_else(|| rootcause::report!("event synchronization requires a calendar"))?;
        let mut tx = self.pool.begin().await.map_err(report)?;
        let mut log = ChangeLogBatch::default();
        fence(&mut tx, lease).await?;
        if let Some(observed) = observed {
            retire_sources(&mut tx, &mut log, target.calendar_id, &observed).await?;
        }
        sqlx::query!("UPDATE calendar_outlook_work SET cursor=$2,lease_id=NULL,lease_until=NULL,next_run_at=now()+interval '2 minutes',last_error=NULL,attempts=0 WHERE id=$1",lease.id,cursor).execute(&mut *tx).await.map_err(report)?;
        sqlx::query!(r#"UPDATE calendars SET synced_at=now(),last_sync_error=NULL,last_sync_error_at=NULL,consecutive_sync_failures=0,
            materialized_starts_at=$2,materialized_ends_at=$3,materialized_start_date=$4,materialized_end_date=$5 WHERE id=$1"#,
            target.calendar_id,target.range.starts_at,target.range.ends_at,target.range.start_date,target.range.end_date).execute(&mut *tx).await.map_err(report)?;
        sqlx::query!(r#"UPDATE calendar_accounts a SET sync_status=CASE WHEN EXISTS(SELECT 1 FROM calendars c WHERE c.account_id=a.id AND NOT c.is_deleted AND c.synced_at IS NULL) THEN 'syncing' ELSE 'ready' END,
            last_synced_at=now(),last_sync_error=NULL WHERE a.id=$1"#,lease.account_id).execute(&mut *tx).await.map_err(report)?;
        log.commit(tx).await
    }
    async fn fail_outlook_calendar(
        &self,
        lease: &OutlookCalendarLease,
        kind: CalendarProviderErrorKind,
    ) -> Result<(), Report> {
        let message = match kind {
            CalendarProviderErrorKind::ReauthRequired => "Reconnect Microsoft calendar",
            CalendarProviderErrorKind::Permanent => "Microsoft could not synchronize this calendar",
            _ => "Microsoft calendar synchronization will retry",
        };
        let mut tx = self.pool.begin().await.map_err(report)?;
        // An old worker must not alter the replacement grant's health.
        if fence(&mut tx, lease).await.is_err() {
            return Ok(());
        }
        sqlx::query!(r#"UPDATE calendar_outlook_work SET lease_id=NULL,lease_until=NULL,last_error=$2,attempts=attempts+1,
            next_run_at=now()+make_interval(secs=>LEAST(900,30*power(2,LEAST(attempts,5)))::int) WHERE id=$1"#,lease.id,message).execute(&mut *tx).await.map_err(report)?;
        if let Some(target) = &lease.target {
            sqlx::query!("UPDATE calendars SET last_sync_error=$2,last_sync_error_at=now(),consecutive_sync_failures=consecutive_sync_failures+1 WHERE id=$1",target.calendar_id,message).execute(&mut *tx).await.map_err(report)?;
        }
        sqlx::query!(
            "UPDATE calendar_accounts SET sync_status=$2,last_sync_error=$3 WHERE id=$1",
            lease.account_id,
            if kind == CalendarProviderErrorKind::ReauthRequired {
                "reauth_required"
            } else {
                "error"
            },
            message
        )
        .execute(&mut *tx)
        .await
        .map_err(report)?;
        tx.commit().await.map_err(report)
    }
}

async fn reset_cursor(tx: &mut Transaction<'_, Postgres>, id: Uuid) -> Result<(), Report> {
    sqlx::query!("UPDATE calendar_outlook_work SET cursor=NULL,page_cursor=NULL,next_page=NULL,terminal_cursor=NULL,pending_ids='{}',visited_pages='{}',page_loaded=false,full_scan=true,scan_id=gen_random_uuid() WHERE id=$1",id).execute(&mut **tx).await.map_err(report)?;
    Ok(())
}
