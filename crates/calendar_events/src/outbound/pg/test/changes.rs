use std::collections::{BTreeMap, BTreeSet, HashSet};

use super::*;
use crate::domain::changes::{
    CalendarChangeLogPruner, CalendarChangeOp, CalendarChangeRepository, CalendarChangeService,
    CalendarLinkWatermark, CalendarWatermark, EventOccurrence,
};
use crate::outbound::pg::change_log::op_from_row;

async fn logged(pool: &PgPool, link_id: Uuid) -> Vec<(i64, CalendarChangeOp)> {
    sqlx::query!(
        r#"
        SELECT seq, kind, event_id, calendar_id
        FROM calendar_change_log
        WHERE link_id = $1
        ORDER BY seq
        "#,
        link_id,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| {
        (
            row.seq,
            op_from_row(row.kind, row.event_id, row.calendar_id).unwrap(),
        )
    })
    .collect()
}

async fn ops_after(pool: &PgPool, link_id: Uuid, after: i64) -> Vec<CalendarChangeOp> {
    logged(pool, link_id)
        .await
        .into_iter()
        .filter(|(seq, _)| *seq > after)
        .map(|(_, op)| op)
        .collect()
}

async fn counter(pool: &PgPool, link_id: Uuid) -> i64 {
    sqlx::query_scalar!(
        "SELECT seq FROM calendar_change_counters WHERE link_id = $1",
        link_id,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .unwrap_or(0)
}

fn primary_calendar(provider_calendar_id: &str, name: &str) -> ProviderCalendar {
    ProviderCalendar {
        provider_calendar_id: provider_calendar_id.to_string(),
        name: name.to_string(),
        description: None,
        time_zone: Some("UTC".to_string()),
        color: None,
        access_role: Some("owner".to_string()),
        is_primary: provider_calendar_id == "primary",
        is_selected: true,
        default_reminders: Vec::new(),
    }
}

/// A claimed Google job for `link_id`, the precondition for every fenced
/// provider write.
async fn claimed_job(
    repo: &PgCalendarRepository,
    link_id: Uuid,
) -> (CalendarBackfillJobKey, Uuid, Uuid) {
    let enabled = repo
        .apply_google_grant(
            link_id,
            complete_grant(),
            CalendarGrantIntent::CalendarRequested,
        )
        .await
        .unwrap();
    let job = enabled
        .jobs
        .iter()
        .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
        .unwrap();
    let key = CalendarBackfillJobKey {
        job_id: job.id,
        email_link_id: link_id,
    };
    let CalendarBackfillClaim::Claimed {
        lease_token,
        account_id,
    } = repo.claim_google_backfill(key).await.unwrap()
    else {
        panic!("Google job should be claimable");
    };
    (key, lease_token, account_id)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn event_writes_log_one_row_per_change_and_skip_unchanged_echoes(pool: PgPool) {
    let owner_id = "macro|changes-upsert@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    let upsert = timed_upsert(owner_id, link_id, provider, "logged@example.com", "One", 1);
    let event_id = repo.upsert_event_fixture(upsert.clone()).await.unwrap();

    repo.upsert_event_fixture(upsert.clone()).await.unwrap();
    let mut edited = upsert;
    edited.event.title = "Two".to_string();
    edited.event.sequence = 2;
    edited.event.updated_at += Duration::minutes(5);
    repo.upsert_event_fixture(edited).await.unwrap();

    assert_eq!(
        logged(&pool, link_id).await,
        vec![
            (1, CalendarChangeOp::UpsertCalendar(provider.1)),
            (2, CalendarChangeOp::UpsertEvent(event_id)),
            (3, CalendarChangeOp::UpsertEvent(event_id)),
        ],
        "the identical re-upsert in between logged nothing"
    );
    assert_eq!(counter(&pool, link_id).await, 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_upserts_log_only_visible_changes(pool: PgPool) {
    let owner_id = "macro|changes-calendar@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let account_id = repo.upsert_google_account(link_id).await.unwrap();
    let calendar = primary_calendar("primary", "Primary");
    let calendar_id = repo
        .upsert_calendar_fixture(account_id, calendar.clone())
        .await
        .unwrap();

    repo.upsert_calendar_fixture(account_id, calendar.clone())
        .await
        .unwrap();
    repo.upsert_calendar_fixture(
        account_id,
        ProviderCalendar {
            name: "Renamed".to_string(),
            ..calendar
        },
    )
    .await
    .unwrap();

    assert_eq!(
        ops_after(&pool, link_id, 0).await,
        vec![
            CalendarChangeOp::UpsertCalendar(calendar_id),
            CalendarChangeOp::UpsertCalendar(calendar_id),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_list_reconcile_logs_its_removals_contiguously(pool: PgPool) {
    let owner_id = "macro|changes-reconcile@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (key, lease_token, account_id) = claimed_job(&repo, link_id).await;
    let kept = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("primary", "Primary"),
        )
        .await
        .unwrap()
        .id;
    let dropped = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("team", "Team"),
        )
        .await
        .unwrap()
        .id;
    let mut first = timed_upsert(
        owner_id,
        link_id,
        (account_id, dropped),
        "first@example.com",
        "First",
        1,
    );
    first.event.calendar_id = Some(dropped);
    let mut second = timed_upsert(
        owner_id,
        link_id,
        (account_id, dropped),
        "second@example.com",
        "Second",
        1,
    );
    second.event.calendar_id = Some(dropped);
    let first = repo.upsert_event_fixture(first).await.unwrap();
    let second = repo.upsert_event_fixture(second).await.unwrap();
    let before = counter(&pool, link_id).await;

    repo.reconcile_google_calendar_list(key, lease_token, account_id, vec![kept])
        .await
        .unwrap();

    let rows: Vec<(i64, CalendarChangeOp)> = logged(&pool, link_id)
        .await
        .into_iter()
        .filter(|(seq, _)| *seq > before)
        .collect();
    assert_eq!(
        rows.iter().map(|(seq, _)| *seq).collect::<Vec<_>>(),
        vec![before + 1, before + 2, before + 3],
        "one transaction appends one contiguous block"
    );
    assert_eq!(
        rows.into_iter().map(|(_, op)| op).collect::<HashSet<_>>(),
        HashSet::from([
            CalendarChangeOp::DeleteEvent(first),
            CalendarChangeOp::DeleteEvent(second),
            CalendarChangeOp::DeleteCalendar(dropped),
        ])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn snapshot_tombstones_and_source_removal_log_deletions(pool: PgPool) {
    let owner_id = "macro|changes-tombstone@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (key, lease_token, account_id) = claimed_job(&repo, link_id).await;
    let calendar_id = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("primary", "Primary"),
        )
        .await
        .unwrap()
        .id;
    let provider = (account_id, calendar_id);
    let unobserved = repo
        .upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
            provider,
            "unobserved@example.com",
            "Unobserved",
            1,
        ))
        .await
        .unwrap();
    let removed = repo
        .upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
            provider,
            "removed@example.com",
            "Removed",
            1,
        ))
        .await
        .unwrap();
    let before = counter(&pool, link_id).await;

    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "token".to_string(),
            observed_provider_event_ids: Some(vec!["provider-removed@example.com".to_string()]),
            materialized_range: None,
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.remove_google_source(account_id, calendar_id, "provider-removed@example.com")
        .await
        .unwrap();

    assert_eq!(
        ops_after(&pool, link_id, before).await,
        vec![
            CalendarChangeOp::DeleteEvent(unobserved),
            CalendarChangeOp::DeleteEvent(removed),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sync_error_badge_logs_when_it_appears_changes_and_clears(pool: PgPool) {
    let owner_id = "macro|changes-badge@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (key, lease_token, account_id) = claimed_job(&repo, link_id).await;
    let calendar_id = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("primary", "Primary"),
        )
        .await
        .unwrap()
        .id;
    let before = counter(&pool, link_id).await;
    let threshold = usize::try_from(CALENDAR_SYNC_FAILURE_BADGE_THRESHOLD).unwrap();

    for _ in 0..threshold + 1 {
        repo.record_google_calendar_sync_error(key, lease_token, account_id, calendar_id, "boom")
            .await
            .unwrap();
    }
    assert_eq!(
        ops_after(&pool, link_id, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "only the failure that crosses the threshold shows a badge"
    );
    repo.record_google_calendar_sync_error(key, lease_token, account_id, calendar_id, "worse")
        .await
        .unwrap();
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "token".to_string(),
            observed_provider_event_ids: None,
            materialized_range: None,
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();
    repo.commit_google_calendar_sync(
        key,
        lease_token,
        account_id,
        GoogleCalendarSyncSnapshot {
            calendar_id,
            next_sync_token: "token-2".to_string(),
            observed_provider_event_ids: None,
            materialized_range: None,
            cancelled_provider_event_ids: Vec::new(),
        },
        0,
    )
    .await
    .unwrap();

    assert_eq!(
        ops_after(&pool, link_id, before).await,
        vec![
            CalendarChangeOp::UpsertCalendar(calendar_id),
            CalendarChangeOp::UpsertCalendar(calendar_id),
            CalendarChangeOp::UpsertCalendar(calendar_id),
        ],
        "a reworded badge and its clearing log; a quiet commit does not"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn disconnecting_logs_every_calendar_and_event_removal(pool: PgPool) {
    let owner_id = "macro|changes-disconnect@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (_account_id, calendar_id, event_id, _channel_id) =
        connected_calendar(&pool, &repo, owner_id, link_id).await;
    let before = counter(&pool, link_id).await;

    repo.disconnect_google_calendar(owner_id, link_id)
        .await
        .unwrap()
        .expect("the owner's inbox is disconnectable");

    assert_eq!(
        ops_after(&pool, link_id, before)
            .await
            .into_iter()
            .collect::<HashSet<_>>(),
        HashSet::from([
            CalendarChangeOp::DeleteCalendar(calendar_id),
            CalendarChangeOp::DeleteEvent(event_id),
        ])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn watermarks_cover_owned_and_delegated_links_only(pool: PgPool) {
    let owner_id = "macro|changes-owner@example.com";
    let delegate_id = "macro|changes-delegate@example.com";
    insert_user(&pool, owner_id).await;
    insert_user(&pool, delegate_id).await;
    let shared = insert_link(&pool, owner_id).await;
    let private = insert_link(&pool, owner_id).await;
    let own = insert_link(&pool, delegate_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    provider_ids(&repo, shared).await;
    provider_ids(&repo, private).await;
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        delegate_id,
        owner_id,
        shared,
    )
    .execute(&pool)
    .await
    .unwrap();

    let watermark = repo.current_watermark(delegate_id).await.unwrap();

    assert_eq!(
        watermark.links().collect::<Vec<_>>(),
        {
            let mut links = vec![
                CalendarLinkWatermark {
                    link_id: shared,
                    seq: 1,
                },
                CalendarLinkWatermark {
                    link_id: own,
                    seq: 0,
                },
            ];
            links.sort_by_key(|link| link.link_id);
            links
        },
        "the owner's undelegated inbox stays invisible"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pruning_raises_the_floor_and_forces_stale_clients_to_reset(pool: PgPool) {
    let owner_id = "macro|changes-prune@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    for n in 0..3 {
        repo.upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
            provider,
            &format!("prune-{n}@example.com"),
            "Pruned",
            1,
        ))
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE calendar_change_log SET created_at = now() - interval '40 days' WHERE link_id = $1 AND seq <= 2",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let removed = repo
        .prune_change_log(Utc::now() - Duration::days(30), 100)
        .await
        .unwrap();

    assert_eq!(removed, 2);
    let at = |seq| CalendarWatermark::from_links([CalendarLinkWatermark { link_id, seq }]);
    let logs = repo.link_logs(owner_id, &at(2), 10).await.unwrap();
    assert_eq!((logs[0].counter, logs[0].floor), (4, 2));
    let service = CalendarChangeService::new(repo.clone());
    assert!(
        service
            .changes_since(owner_id, at(1))
            .await
            .unwrap()
            .reset_required
    );
    let resumed = service.changes_since(owner_id, at(2)).await.unwrap();
    assert!(!resumed.reset_required);
    assert_eq!(resumed.events.len(), 2);
    assert_eq!(resumed.new_watermark, at(4));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_prune_batch_inside_a_timestamp_tie_removes_the_lowest_sequences(pool: PgPool) {
    let owner_id = "macro|changes-prune-tie@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let provider = provider_ids(&repo, link_id).await;
    for n in 0..3 {
        repo.upsert_event_fixture(timed_upsert(
            owner_id,
            link_id,
            provider,
            &format!("prune-tie-{n}@example.com"),
            "Pruned",
            1,
        ))
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE calendar_change_log SET created_at = now() - interval '40 days' WHERE link_id = $1",
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let removed = repo
        .prune_change_log(Utc::now() - Duration::days(30), 2)
        .await
        .unwrap();

    assert_eq!(removed, 2);
    assert_eq!(
        logged(&pool, link_id)
            .await
            .into_iter()
            .map(|(seq, _)| seq)
            .collect::<Vec<_>>(),
        vec![3, 4],
        "the retained log stays a contiguous suffix"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn pruning_drops_counters_of_deleted_links(pool: PgPool) {
    let owner_id = "macro|changes-orphan@example.com";
    let link_id = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    provider_ids(&repo, link_id).await;
    sqlx::query!("DELETE FROM email_links WHERE id = $1", link_id)
        .execute(&pool)
        .await
        .unwrap();

    repo.prune_change_log(Utc::now() - Duration::days(30), 100)
        .await
        .unwrap();

    assert_eq!(counter(&pool, link_id).await, 0);
}

/// What a client holds after folding delta pages: each event's series and
/// complete occurrence set, and every calendar.
#[derive(Default)]
struct ClientModel {
    events: BTreeMap<Uuid, (CalendarEvent, Vec<EventOccurrence>)>,
    calendars: BTreeMap<Uuid, VisibleCalendar>,
}

impl ClientModel {
    async fn replay(
        service: &CalendarChangeService<PgCalendarRepository>,
        viewer: &str,
        links: &[Uuid],
    ) -> Self {
        let mut model = Self::default();
        let mut since = CalendarWatermark::from_links(
            links
                .iter()
                .map(|&link_id| CalendarLinkWatermark { link_id, seq: 0 }),
        );
        loop {
            let page = service.changes_since(viewer, since).await.unwrap();
            assert!(!page.reset_required);
            for change in page.events {
                model
                    .events
                    .insert(change.event.id, (change.event, change.occurrences));
            }
            for id in page.deleted_event_ids {
                model.events.remove(&id);
            }
            for calendar in page.calendars {
                model.calendars.insert(calendar.id, calendar);
            }
            for id in page.deleted_calendar_ids {
                model.calendars.remove(&id);
            }
            since = page.new_watermark;
            if !page.has_more {
                return model;
            }
        }
    }

    fn listings(&self, link_of: &BTreeMap<Uuid, Uuid>) -> BTreeSet<String> {
        self.events
            .values()
            .flat_map(|(event, occurrences)| {
                occurrences.iter().map(move |instance| {
                    listing_key(&OccurrenceListing {
                        event: event.clone(),
                        occurrence: instance.occurrence.clone(),
                        link_id: link_of[&event.id],
                        exception: instance.exception.clone(),
                    })
                })
            })
            .collect()
    }
}

fn listing_key(listing: &OccurrenceListing) -> String {
    let (event, occurrence) = listing.clone().into_occurrence_event();
    format!(
        "{} {} {} {} {:?} {:?}",
        listing.link_id,
        occurrence.event_id,
        occurrence.occurrence_key,
        event.title,
        event.status,
        event
            .attendees
            .iter()
            .map(|attendee| (attendee.email.clone(), attendee.response_status))
            .collect::<Vec<_>>(),
    )
}

async fn assert_replay_matches_reads(repo: &PgCalendarRepository, viewer: &str, links: &[Uuid]) {
    let service = CalendarChangeService::new(repo.clone());
    let model = ClientModel::replay(&service, viewer, links).await;
    let starts_at = Utc.with_ymd_and_hms(2025, 1, 1, 0, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2028, 1, 1, 0, 0, 0).unwrap();
    let listings = repo
        .list_occurrences(
            viewer,
            OccurrenceRange {
                starts_at,
                ends_at,
                start_date: starts_at.date_naive(),
                end_date: ends_at.date_naive(),
            },
            None,
            2000,
        )
        .await
        .unwrap();
    let link_of: BTreeMap<Uuid, Uuid> = model
        .events
        .keys()
        .map(|&id| {
            let link = listings
                .iter()
                .find(|listing| listing.event.id == id)
                .map(|listing| listing.link_id)
                .expect("every replayed event is listed");
            (id, link)
        })
        .collect();

    assert_eq!(
        model.listings(&link_of),
        listings.iter().map(listing_key).collect::<BTreeSet<_>>()
    );
    assert_eq!(model.calendars.into_values().collect::<Vec<_>>(), {
        let mut calendars = repo.list_visible_calendars(viewer).await.unwrap();
        calendars.sort_by_key(|calendar| calendar.id);
        calendars
    });
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replaying_the_log_reproduces_what_the_viewer_reads(pool: PgPool) {
    let owner_id = "macro|changes-replay@example.com";
    let delegate_id = "macro|changes-replay-delegate@example.com";
    insert_user(&pool, owner_id).await;
    insert_user(&pool, delegate_id).await;
    let link_id = insert_link(&pool, owner_id).await;
    let other_link = insert_link(&pool, owner_id).await;
    let repo = PgCalendarRepository::new(pool.clone());
    let (key, lease_token, account_id) = claimed_job(&repo, link_id).await;
    let primary = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("primary", "Primary"),
        )
        .await
        .unwrap()
        .id;
    let team = repo
        .upsert_google_calendar(
            key,
            lease_token,
            account_id,
            primary_calendar("team", "Team"),
        )
        .await
        .unwrap()
        .id;
    let other_provider = provider_ids(&repo, other_link).await;

    // A recurring series whose second occurrence declines for one instance.
    let mut series = timed_upsert(
        owner_id,
        link_id,
        (account_id, primary),
        "series@example.com",
        "Series",
        1,
    );
    let declined_start = Utc.with_ymd_and_hms(2026, 7, 25, 14, 0, 0).unwrap();
    series.occurrences[1].recurrence_id = Some(declined_start.to_rfc3339());
    series.overrides = vec![CalendarEventOverride {
        visibility: None,
        transparency: None,
        sequence: None,
        source_updated_at: None,
        recurrence_id: declined_start.to_rfc3339(),
        original_time: EventStart::Timed(declined_start),
        time: EventTime::Timed {
            starts_at: declined_start,
            ends_at: declined_start + Duration::hours(1),
            time_zone: Some("UTC".to_string()),
        },
        title: Some("Moved".to_string()),
        description: None,
        location: None,
        status: None,
        attendees: Some(vec![CalendarAttendee {
            response_status: AttendeeResponseStatus::Declined,
            ..series.event.attendees[0].clone()
        }]),
    }];
    repo.upsert_event_fixture(series.clone()).await.unwrap();
    let mut edited = series;
    edited.event.title = "Series, renamed".to_string();
    edited.event.sequence = 2;
    edited.event.updated_at += Duration::minutes(5);
    repo.upsert_event_fixture(edited).await.unwrap();

    let mut doomed = timed_upsert(
        owner_id,
        link_id,
        (account_id, team),
        "team@example.com",
        "Team only",
        1,
    );
    doomed.event.calendar_id = Some(team);
    repo.upsert_event_fixture(doomed).await.unwrap();
    repo.upsert_event_fixture(timed_upsert(
        owner_id,
        link_id,
        (account_id, primary),
        "removed@example.com",
        "Removed",
        1,
    ))
    .await
    .unwrap();
    repo.remove_google_source(account_id, primary, "provider-removed@example.com")
        .await
        .unwrap();
    repo.reconcile_google_calendar_list(key, lease_token, account_id, vec![primary])
        .await
        .unwrap();
    repo.upsert_google_calendar(
        key,
        lease_token,
        account_id,
        ProviderCalendar {
            color: Some("#0b8043".to_string()),
            ..primary_calendar("primary", "Primary")
        },
    )
    .await
    .unwrap();
    repo.upsert_event_fixture(timed_upsert(
        owner_id,
        other_link,
        other_provider,
        "private@example.com",
        "Other inbox",
        1,
    ))
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO macro_user_links (primary_macro_id, child_macro_id, link_id)
        VALUES ($1, $2, $3)
        "#,
        delegate_id,
        owner_id,
        link_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_replay_matches_reads(&repo, owner_id, &[link_id, other_link]).await;
    assert_replay_matches_reads(&repo, delegate_id, &[link_id]).await;
}
