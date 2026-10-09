use super::*;
use crate::domain::models::{
    AutomaticDeclinePolicy, OutOfOfficeAutoDeclineMode, OutOfOfficeProperties,
};
use crate::domain::outlook::*;
use crate::domain::ports::CalendarProviderErrorKind;

async fn mailbox(pool: &PgPool) -> (PgCalendarRepository, Uuid, String) {
    let owner = "macro|outlook-owner@example.com".to_owned();
    insert_user(pool, &owner).await;
    let link = insert_link(pool, &owner).await;
    sqlx::query!("UPDATE email_links SET provider='OUTLOOK',sync_generation=1,grant_generation=1,is_sync_active=true WHERE id=$1",link).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES($1,1,ARRAY['Calendars.ReadWrite'])",link).execute(pool).await.unwrap();
    (PgCalendarRepository::new(pool.clone()), link, owner)
}
async fn claim(repo: &PgCalendarRepository) -> Option<OutlookCalendarLease> {
    repo.claim_outlook_calendar(
        Uuid::now_v7(),
        OccurrenceRange::maintenance_horizon(Utc::now()),
    )
    .await
    .unwrap()
}
fn discovered_calendar(provider_calendar_id: &str) -> OutlookCalendar {
    OutlookCalendar {
        calendar: ProviderCalendar {
            provider_calendar_id: provider_calendar_id.into(),
            name: "Outlook calendar".into(),
            description: None,
            time_zone: Some("America/Los_Angeles".into()),
            color: None,
            access_role: Some("writer".into()),
            is_primary: provider_calendar_id == "primary",
            is_selected: true,
            default_reminders: vec![],
        },
        online_meeting_providers: vec!["teamsForBusiness".into()],
    }
}
async fn calendar(repo: &PgCalendarRepository) -> OutlookCalendarLease {
    let lease = claim(repo).await.unwrap();
    assert!(lease.target.is_none());
    repo.commit_outlook_calendars(&lease, vec![discovered_calendar("primary")])
        .await
        .unwrap();
    claim(repo).await.unwrap()
}
fn upsert(lease: &OutlookCalendarLease, uid: &str) -> CalendarEventUpsert {
    let target = lease.target.as_ref().unwrap();
    let mut upsert = timed_upsert(
        &lease.owner_id,
        lease.binding.link_id,
        (lease.account_id, target.calendar_id),
        uid,
        "Outlook meeting",
        0,
    );
    let mut source = upsert.source.details().clone();
    source.binding = Some(lease.binding);
    source.observed_access_role = target.observed_access_role.clone();
    upsert.source = CalendarEventSource::Outlook(source);
    upsert.event.is_read_only = false;
    upsert
}
async fn store(repo: &PgCalendarRepository, lease: &OutlookCalendarLease, uid: &str) -> Uuid {
    repo.upsert_event(CalendarEventWrite::OutlookSync {
        lease: Box::new(lease.clone()),
        upsert: upsert(lease, uid),
    })
    .await
    .unwrap()
    .event_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_discovery_keeps_one_work_row_per_account_and_calendar(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let discovery = claim(&repo).await.unwrap();
    assert!(discovery.target.is_none());
    assert!(claim(&repo).await.is_none());
    repo.commit_outlook_calendars(
        &discovery,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("secondary"),
        ],
    )
    .await
    .unwrap();

    let first = claim(&repo).await.unwrap();
    let second = claim(&repo).await.unwrap();
    assert_ne!(
        first.target.as_ref().unwrap().calendar_id,
        second.target.as_ref().unwrap().calendar_id
    );
    assert!(claim(&repo).await.is_none());

    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        discovery.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let rediscovery = claim(&repo).await.unwrap();
    assert_eq!(rediscovery.id, discovery.id);
    assert!(rediscovery.target.is_none());
    repo.commit_outlook_calendars(
        &rediscovery,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("secondary"),
        ],
    )
    .await
    .unwrap();

    let work = sqlx::query!(
        "SELECT id,calendar_id,lease_id FROM calendar_outlook_work WHERE account_id=$1",
        discovery.account_id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(work.len(), 3);
    let account_work = work.iter().find(|row| row.calendar_id.is_none()).unwrap();
    assert_eq!(account_work.id, discovery.id);
    assert!(account_work.lease_id.is_none());
    for lease in [first, second] {
        let row = work.iter().find(|row| row.id == lease.id).unwrap();
        assert_eq!(row.calendar_id, Some(lease.target.unwrap().calendar_id));
        assert_eq!(row.lease_id, Some(lease.lease_id));
    }
    assert!(claim(&repo).await.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_work_rejects_duplicate_account_and_calendar_rows(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let work = sqlx::query!(
        "SELECT id,calendar_id FROM calendar_outlook_work WHERE account_id=$1",
        lease.account_id
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(work.len(), 2);
    assert!(work.iter().any(|row| row.calendar_id.is_none()));
    assert!(work.iter().any(|row| row.calendar_id.is_some()));
    for row in work {
        let error = sqlx::query!(
            r#"INSERT INTO calendar_outlook_work (
                id,account_id,calendar_id,sync_generation,grant_generation,starts_at,ends_at
            )
            SELECT $1,account_id,calendar_id,sync_generation,grant_generation,starts_at,ends_at
            FROM calendar_outlook_work WHERE id=$2"#,
            Uuid::now_v7(),
            row.id
        )
        .execute(&pool)
        .await
        .unwrap_err();
        assert!(error.as_database_error().unwrap().is_unique_violation());
    }

    // Account-level uniqueness must not prevent discovery for another mailbox.
    let link = insert_link(&pool, &owner).await;
    sqlx::query!("UPDATE email_links SET provider='OUTLOOK',sync_generation=1,grant_generation=1,is_sync_active=true WHERE id=$1",link).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES($1,1,ARRAY['Calendars.ReadWrite'])",link).execute(&pool).await.unwrap();
    let other = claim(&repo).await.unwrap();
    assert!(other.target.is_none());
    assert_eq!(other.binding.link_id, link);
    assert_ne!(other.account_id, lease.account_id);
    assert!(claim(&repo).await.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_projection_uses_existing_reads_and_mutation_authorization(pool: PgPool) {
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let id = store(&repo, &lease, "meeting").await;
    let visible = repo.list_visible_calendars(&owner).await.unwrap();
    assert_eq!(visible.len(), 1);
    assert_eq!(visible[0].provider, CalendarProvider::Outlook);
    assert_eq!(
        visible[0].capabilities.conference_provider,
        Some(ConferenceProvider::MicrosoftTeams)
    );
    let target = repo
        .get_event_mutation_target(&owner, id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(target.token_identity.provider, CalendarProvider::Outlook);
    assert_eq!(target.token_identity.binding, Some(lease.binding));
    assert_eq!(target.email_link_id, link);
    assert!(
        repo.get_event_mutation_target("macro|stranger@example.com", id, None)
            .await
            .unwrap()
            .is_none()
    );
    let rows = repo
        .list_occurrences(
            &owner,
            lease.target.as_ref().unwrap().range.clone(),
            None,
            100,
        )
        .await
        .unwrap();
    assert_eq!(rows.len(), 2);
    repo.commit_outlook_calendar(
        &lease,
        Some(vec!["provider-meeting".into()]),
        Some("opaque-cursor".into()),
    )
    .await
    .unwrap();
    assert_eq!(
        repo.sync_status(&owner).await.unwrap(),
        CalendarSyncStatus::Ready
    );
    let change = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(change.event_id, id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outlook_discovery_preserves_coverage_without_google_snapshot_certification(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let target = lease.target.as_ref().unwrap();
    assert_eq!(target.observed_access_role.as_deref(), Some("writer"));
    repo.commit_outlook_calendar(&lease, Some(vec![]), Some("cursor".into()))
        .await
        .unwrap();

    let mut tx = pool.begin().await.unwrap();
    let mut log = ChangeLogBatch::default();
    let stored = upsert_calendar_tx(
        &mut tx,
        &mut log,
        link,
        lease.account_id,
        ProviderCalendar {
            provider_calendar_id: target.provider_calendar_id.clone(),
            name: "Outlook calendar".into(),
            description: None,
            time_zone: Some("America/Los_Angeles".into()),
            color: None,
            access_role: target.observed_access_role.clone(),
            is_primary: true,
            is_selected: true,
            default_reminders: vec![],
        },
        Some(CalendarProvider::Outlook),
    )
    .await
    .unwrap();
    assert!(stored.synced_at.is_some());
    assert_eq!(stored.materialized_starts_at, Some(target.range.starts_at));
    assert_eq!(stored.materialized_ends_at, Some(target.range.ends_at));
    log.commit(tx).await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_invalidates_old_echoes_pruning_and_health(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let old = calendar(&repo).await;
    let id = store(&repo, &old, "keep").await;
    sqlx::query!(
        "UPDATE email_links SET sync_generation=sync_generation+1 WHERE id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.upsert_event(CalendarEventWrite::OutlookSync {
            lease: Box::new(old.clone()),
            upsert: upsert(&old, "stale")
        })
        .await
        .is_err()
    );
    assert!(
        repo.upsert_event(CalendarEventWrite::UserMutation(upsert(
            &old,
            "late-user-echo"
        )))
        .await
        .is_err()
    );
    assert!(
        repo.commit_outlook_calendar(&old, Some(vec![]), Some("stale".into()))
            .await
            .is_err()
    );
    repo.fail_outlook_calendar(
        &old,
        crate::domain::ports::CalendarProviderErrorKind::ReauthRequired,
    )
    .await
    .unwrap();
    assert!(
        repo.get_event_mutation_target(&old.owner_id, id, None)
            .await
            .unwrap()
            .is_some()
    );
    let fresh = claim(&repo).await.unwrap();
    assert_eq!(fresh.binding.sync_generation, 2);
    assert!(fresh.cursor.is_none());
    let status = sqlx::query_scalar!(
        "SELECT sync_status FROM calendar_accounts WHERE id=$1",
        old.account_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_ne!(status, "reauth_required");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn incremental_commit_never_prunes_unseen_events(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    store(&repo, &lease, "one").await;
    let keep = store(&repo, &lease, "two").await;
    repo.commit_outlook_calendar(&lease, None, Some("incremental".into()))
        .await
        .unwrap();
    assert!(
        repo.get_event_mutation_target(&lease.owner_id, keep, None)
            .await
            .unwrap()
            .is_some()
    );
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let fresh = claim(&repo).await.unwrap();
    assert_eq!(fresh.cursor.as_deref(), Some("incremental"));
    repo.commit_outlook_calendar(
        &fresh,
        Some(vec!["provider-one".into()]),
        Some("full".into()),
    )
    .await
    .unwrap();
    assert!(
        repo.get_event_mutation_target(&lease.owner_id, keep, None)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn calendar_opt_out_purges_and_fences_without_disconnecting_mail(pool: PgPool) {
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let id = store(&repo, &lease, "gone").await;
    assert!(
        repo.disconnect_provider_calendar("macro|stranger@example.com", link)
            .await
            .unwrap()
            .is_none()
    );
    let disconnected = repo
        .disconnect_provider_calendar(&owner, link)
        .await
        .unwrap()
        .unwrap();
    assert!(disconnected.watch_channels.is_empty());
    assert!(
        repo.upsert_event(CalendarEventWrite::OutlookSync {
            lease: Box::new(lease.clone()),
            upsert: upsert(&lease, "late")
        })
        .await
        .is_err()
    );
    assert!(claim(&repo).await.is_none());
    assert!(
        repo.list_visible_calendars(&owner)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        sqlx::query_scalar!("SELECT is_sync_active FROM email_links WHERE id=$1", link)
            .fetch_one(&pool)
            .await
            .unwrap()
    );
    let change = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(change.event_id, id);
    assert!(matches!(
        change.event,
        crate::domain::events::CalendarTopicEvent::Deleted(_)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn publication_ack_preserves_a_concurrent_projection_revision(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let id = store(&repo, &lease, "changing").await;
    let old = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_events SET title='New title' WHERE id=$1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.complete_projection(&old).await.unwrap();
    let new = repo
        .claim_projection(Uuid::now_v7())
        .await
        .unwrap()
        .unwrap();
    assert!(new.revision > old.revision);
    assert_eq!(new.event_id, id);
    repo.complete_projection(&new).await.unwrap();
    assert!(
        repo.claim_projection(Uuid::now_v7())
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn simultaneous_workers_do_not_share_a_calendar_lease(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    assert!(claim(&repo).await.is_none());
    repo.renew_outlook_calendar(&lease).await.unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let fresh = claim(&repo).await.unwrap();
    assert_eq!(fresh.id, lease.id);
    assert_ne!(fresh.lease_id, lease.lease_id);
    assert!(repo.renew_outlook_calendar(&lease).await.is_err());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn crash_after_echo_replays_one_event_without_advancing_the_page_cursor(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![
                ("provider-one".into(), "provider-one".into()),
                ("provider-two".into(), "provider-two".into()),
            ],
            removed: vec![],
            next: Some("next-page".into()),
            delta: None,
        }),
    )
    .await
    .unwrap();
    let first = claim(&repo).await.unwrap();
    let id = store(&repo, &first, "one").await;
    // The echo committed, then the process died before acknowledging its child.
    sqlx::query!(
        "UPDATE calendar_outlook_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        first.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let replay = claim(&repo).await.unwrap();
    assert_eq!(
        replay.pending_ids.first().map(String::as_str),
        Some("provider-one")
    );
    assert!(replay.cursor.is_none());
    assert_eq!(store(&repo, &replay, "one").await, id);
    repo.checkpoint_outlook_calendar(
        &replay,
        OutlookCalendarProgress::Event {
            id: "provider-one".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    let second = claim(&repo).await.unwrap();
    assert_eq!(second.pending_ids, vec!["provider-two"]);
    assert!(
        repo.checkpoint_outlook_calendar(&second, OutlookCalendarProgress::Finish)
            .await
            .is_err()
    );
    repo.checkpoint_outlook_calendar(
        &second,
        OutlookCalendarProgress::Event {
            id: "provider-two".into(),
            exists: false,
        },
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    let next = claim(&repo).await.unwrap();
    assert_eq!(next.page_cursor.as_deref(), Some("next-page"));
    assert!(next.cursor.is_none());
    repo.checkpoint_outlook_calendar(
        &next,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![],
            removed: vec![],
            next: None,
            delta: Some("terminal".into()),
        }),
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    let cursor = sqlx::query_scalar!(
        "SELECT cursor FROM calendar_outlook_work WHERE id=$1",
        lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(cursor.as_deref(), Some("terminal"));
    assert!(
        repo.get_event_mutation_target(&lease.owner_id, id, None)
            .await
            .unwrap()
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tombstones_refresh_known_series_and_reset_unknown_history(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![("occurrence".into(), "provider-series".into())],
            removed: vec![],
            next: None,
            delta: Some("baseline".into()),
        }),
    )
    .await
    .unwrap();
    let event = claim(&repo).await.unwrap();
    store(&repo, &event, "series").await;
    repo.checkpoint_outlook_calendar(
        &event,
        OutlookCalendarProgress::Event {
            id: "provider-series".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let delta = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(
        &delta,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![],
            removed: vec!["occurrence".into()],
            next: None,
            delta: Some("after-delete".into()),
        }),
    )
    .await
    .unwrap();
    let refresh = claim(&repo).await.unwrap();
    assert_eq!(refresh.pending_ids, vec!["provider-series"]);
    repo.checkpoint_outlook_calendar(
        &refresh,
        OutlookCalendarProgress::Event {
            id: "provider-series".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let delta = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(
        &delta,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![],
            removed: vec!["unobserved-occurrence".into()],
            next: None,
            delta: Some("unsafe".into()),
        }),
    )
    .await
    .unwrap();
    let reset = claim(&repo).await.unwrap();
    assert!(reset.cursor.is_none());
    assert!(reset.page_cursor.is_none());
    assert!(!reset.page_loaded);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_clears_only_the_replaced_credentials_reauth_state(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.fail_outlook_calendar(&lease, CalendarProviderErrorKind::ReauthRequired)
        .await
        .unwrap();
    assert!(claim(&repo).await.is_none());
    sqlx::query!(
        "UPDATE email_links SET grant_generation=2,sync_generation=2 WHERE id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_link_microsoft_scopes SET grant_generation=2 WHERE link_id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    let catalog = claim(&repo).await.unwrap();
    assert_eq!(catalog.binding.grant_generation, 2);
    repo.commit_outlook_calendars(&catalog, vec![])
        .await
        .unwrap();
    let status = sqlx::query_scalar!(
        "SELECT sync_status FROM calendar_accounts WHERE email_link_id=$1",
        link
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(status, "ready");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn email_and_popup_reminders_have_independent_delivery_and_stale_firings_drop(pool: PgPool) {
    use crate::domain::models::ReminderDeliveryMethod;
    use crate::domain::ports::CalendarReminderDispatchRepo;
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let target = lease.target.as_ref().unwrap();
    let now = Utc::now().trunc_subsecs(0);
    let starts = now + Duration::minutes(9);
    let reminders = EventReminders {
        use_default: false,
        overrides: vec![
            EventReminderOverride {
                method: "popup".into(),
                minutes: 10,
            },
            EventReminderOverride {
                method: "email".into(),
                minutes: 10,
            },
            EventReminderOverride {
                method: "email".into(),
                minutes: 10,
            },
        ],
    };
    let mut event = reminder_upsert(
        &owner,
        link,
        (lease.account_id, target.calendar_id),
        "reminder-channels",
        starts,
        reminders.clone(),
    );
    let mut source = event.source.details().clone();
    source.binding = Some(lease.binding);
    event.source = CalendarEventSource::Outlook(source);
    let id = repo
        .upsert_event(CalendarEventWrite::UserMutation(event.clone()))
        .await
        .unwrap()
        .event_id;
    let first = repo.due_reminder_firings(now, None, 1).await.unwrap();
    let second = repo
        .due_reminder_firings(now, first.first(), 1)
        .await
        .unwrap();
    assert_eq!(first.len(), 1);
    assert_eq!(second.len(), 1);
    assert_ne!(first[0].method, second[0].method);
    let mut firings = first;
    firings.extend(second);
    assert_eq!(
        firings
            .iter()
            .filter(|f| f.method == ReminderDeliveryMethod::Email)
            .count(),
        1
    );
    for firing in &firings {
        assert!(repo.find_due_reminder(firing).await.unwrap().is_some());
        assert!(
            repo.claim_reminder_delivery(firing, now - Duration::minutes(5))
                .await
                .unwrap()
        );
        repo.complete_reminder_delivery(firing).await.unwrap();
    }
    assert!(
        repo.due_reminder_firings(now, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
    // A newer projection preserves claims for the same firing, then a moved
    // occurrence invalidates queued work and acquires a fresh delivery identity.
    event.event.sequence += 1;
    event.event.updated_at += Duration::seconds(1);
    repo.upsert_event(CalendarEventWrite::UserMutation(event.clone()))
        .await
        .unwrap();
    assert!(
        repo.due_reminder_firings(now, None, 100)
            .await
            .unwrap()
            .is_empty()
    );
    event.event.sequence += 1;
    event.event.updated_at += Duration::seconds(1);
    event.event.time = EventTime::Timed {
        starts_at: starts + Duration::hours(1),
        ends_at: starts + Duration::hours(2),
        time_zone: Some("UTC".into()),
    };
    for occurrence in &mut event.occurrences {
        occurrence.time = event.event.time.clone();
    }
    repo.upsert_event(CalendarEventWrite::UserMutation(event))
        .await
        .unwrap();
    for firing in &firings {
        assert!(repo.find_due_reminder(firing).await.unwrap().is_none());
    }
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) AS \"count!\" FROM calendar_event_reminder_firings WHERE event_id=$1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        2
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn automatic_decline_journals_before_submission_and_never_repeats_uncertain_replies(
    pool: PgPool,
) {
    use crate::domain::models::{
        AutomaticDeclinePolicy, OutOfOfficeAutoDeclineMode, OutOfOfficeProperties,
        ProviderCalendarTarget,
    };
    use crate::domain::outlook::automatic_decline::*;
    use crate::domain::ports::CalendarProviderError;
    use std::sync::{Arc, Mutex};
    struct Provider {
        away: AwayOccurrence,
        invitation: Arc<Mutex<AwayOccurrence>>,
        submitted: Arc<Mutex<usize>>,
    }
    impl AutomaticDeclineProvider for Provider {
        async fn away_occurrence(
            &self,
            _: &str,
            _: &ProviderCalendarTarget,
            id: &str,
            _: Option<&str>,
        ) -> Result<Option<AwayOccurrence>, CalendarProviderError> {
            Ok(Some(if id == "provider-away" {
                self.away.clone()
            } else {
                self.invitation.lock().unwrap().clone()
            }))
        }
        async fn decline_away_invitation(
            &self,
            _: &str,
            _: &ProviderCalendarTarget,
            id: &str,
            comment: Option<&str>,
        ) -> Result<AwaySubmissionOutcome, CalendarProviderError> {
            assert_eq!(id, "provider-invitation");
            assert_eq!(comment, Some("Away this week"));
            *self.submitted.lock().unwrap() += 1;
            Err(CalendarProviderError::new(
                CalendarProviderErrorKind::Transient,
                "Response was lost",
            ))
        }
    }
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let target = lease.target.as_ref().unwrap();
    let starts = Utc::now() + Duration::days(1);
    let policy = AutomaticDeclinePolicy {
        id: Uuid::now_v7(),
        enabled_at: Utc::now(),
        properties: OutOfOfficeProperties {
            auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations,
            decline_message: Some("Away this week".into()),
        },
    };
    for uid in ["away", "invitation"] {
        let mut event = reminder_upsert(
            &owner,
            link,
            (lease.account_id, target.calendar_id),
            uid,
            starts,
            EventReminders::default(),
        );
        let mut source = event.source.details().clone();
        source.binding = Some(lease.binding);
        if uid == "away" {
            source.automatic_decline = Some(policy.clone());
            event.event.event_type = EventType::OutOfOffice;
        }
        event.source = CalendarEventSource::Outlook(source);
        repo.upsert_event(CalendarEventWrite::UserMutation(event))
            .await
            .unwrap();
    }
    let invitation = AwayOccurrence {
        provider_id: "provider-invitation".into(),
        starts_at: starts,
        ends_at: starts + Duration::hours(1),
        created_at: Utc::now(),
        is_organizer: false,
        cancelled: false,
        response: AttendeeResponseStatus::NeedsAction,
        policy: None,
    };
    let mut away = invitation.clone();
    away.provider_id = "provider-away".into();
    away.is_organizer = true;
    away.policy = Some(policy);
    let provider = Provider {
        away,
        invitation: Arc::new(Mutex::new(invitation)),
        submitted: Arc::new(Mutex::new(0)),
    };
    run(&repo, &provider, &lease, "token", false).await.unwrap();
    assert!(repo.away_submissions(&lease).await.unwrap().is_empty());
    run(&repo, &provider, &lease, "token", true).await.unwrap();
    assert_eq!(*provider.submitted.lock().unwrap(), 1);
    assert_eq!(repo.away_submissions(&lease).await.unwrap().len(), 1);
    run(&repo, &provider, &lease, "token", true).await.unwrap();
    assert_eq!(*provider.submitted.lock().unwrap(), 1);
    sqlx::query!("UPDATE calendar_outlook_declines SET submitted_at=now()-interval '6 minutes' WHERE work_id=$1",lease.id).execute(&pool).await.unwrap();
    assert!(
        repo.list_visible_calendars(&owner).await.unwrap()[0]
            .sync_error
            .as_deref()
            .unwrap()
            .contains("could not be confirmed")
    );
    provider.invitation.lock().unwrap().response = AttendeeResponseStatus::Declined;
    sqlx::query!(
        "UPDATE calendar_outlook_declines SET next_check_at=now() WHERE work_id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    run(&repo, &provider, &lease, "token", false).await.unwrap();
    assert!(repo.away_submissions(&lease).await.unwrap().is_empty());
    assert_eq!(*provider.submitted.lock().unwrap(), 1);
    assert!(
        repo.list_visible_calendars(&owner).await.unwrap()[0]
            .sync_error
            .is_none()
    );
    sqlx::query!(
        "UPDATE email_links SET grant_generation=grant_generation+1 WHERE id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(run(&repo, &provider, &lease, "token", true).await.is_err());
    assert_eq!(*provider.submitted.lock().unwrap(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrence_reminders_override_series_and_survive_calendar_default_changes(pool: PgPool) {
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let target = lease.target.as_ref().unwrap();
    let starts = Utc::now() + Duration::days(1);
    let mut event = reminder_upsert(
        &owner,
        link,
        (lease.account_id, target.calendar_id),
        "series-reminders",
        starts,
        EventReminders::default(),
    );
    let mut source = event.source.details().clone();
    source.binding = Some(lease.binding);
    event.source = CalendarEventSource::Outlook(source);
    event.event.recurrence_lines = vec!["RRULE:FREQ=DAILY;COUNT=3".into()];
    event.occurrences.clear();
    for day in 0..3 {
        let start = starts + Duration::days(day);
        let time = EventTime::Timed {
            starts_at: start,
            ends_at: start + Duration::hours(1),
            time_zone: Some("UTC".into()),
        };
        let key = start.to_rfc3339();
        event.occurrences.push(CalendarOccurrence {
            event_id: event.event.id,
            occurrence_key: key.clone(),
            recurrence_id: Some(key.clone()),
            time: time.clone(),
            is_cancelled: false,
        });
        if day > 0 {
            event.overrides.push(CalendarEventOverride {
                reminders: Some(EventReminders {
                    use_default: false,
                    overrides: if day == 1 {
                        vec![]
                    } else {
                        vec![EventReminderOverride {
                            method: "email".into(),
                            minutes: 25,
                        }]
                    },
                }),
                automatic_decline: None,
                visibility: None,
                transparency: None,
                sequence: None,
                source_updated_at: None,
                recurrence_id: key,
                original_time: EventStart::Timed(start),
                time,
                title: None,
                description: None,
                location: None,
                status: None,
                attendees: None,
            });
        }
    }
    let id = repo
        .upsert_event(CalendarEventWrite::UserMutation(event))
        .await
        .unwrap()
        .event_id;
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) AS \"count!\" FROM calendar_event_reminder_firings WHERE event_id=$1",
            id
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        1
    );
    repo.upsert_calendar_fixture(
        lease.account_id,
        ProviderCalendar {
            provider_calendar_id: "primary".into(),
            name: "Primary".into(),
            description: None,
            time_zone: Some("UTC".into()),
            color: None,
            access_role: Some("writer".into()),
            is_primary: true,
            is_selected: true,
            default_reminders: vec![EventReminderOverride {
                method: "popup".into(),
                minutes: 10,
            }],
        },
    )
    .await
    .unwrap();
    let firings=sqlx::query!("SELECT occurrence_key,minutes_before,method FROM calendar_event_reminder_firings WHERE event_id=$1 ORDER BY occurrence_key",id).fetch_all(&pool).await.unwrap();
    assert_eq!(firings.len(), 2);
    assert_eq!(
        (
            firings[0].occurrence_key.as_str(),
            firings[0].minutes_before,
            firings[0].method.as_str()
        ),
        (starts.to_rfc3339().as_str(), 10, "popup")
    );
    assert_eq!(
        (
            firings[1].occurrence_key.as_str(),
            firings[1].minutes_before,
            firings[1].method.as_str()
        ),
        (
            (starts + Duration::days(2)).to_rfc3339().as_str(),
            25,
            "email"
        )
    );
    let rows = repo
        .list_occurrences(&owner, target.range.clone(), None, 100)
        .await
        .unwrap();
    assert_eq!(rows.len(), 3);
    assert!(rows[1].event.reminders.overrides.is_empty());
    assert!(!rows[1].event.reminders.use_default);
    assert_eq!(rows[2].event.reminders.overrides[0].method, "email");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn automatic_reply_journal_survives_calendar_and_mailbox_reconnection(pool: PgPool) {
    use crate::domain::outlook::automatic_decline::*;
    let (repo, link, owner) = mailbox(&pool).await;
    sqlx::query!("UPDATE email_links SET provider_tenant_id='tenant',provider_mailbox_id='mailbox' WHERE id=$1",link).execute(&pool).await.unwrap();
    let lease = calendar(&repo).await;
    let candidate = AwayCandidate {
        away_id: "away".into(),
        away_recurrence: None,
        invitation_id: "invitation".into(),
        invitation_recurrence: Some("2026-10-05T12:00:00+00:00".into()),
    };
    let submitted = repo
        .begin_away_submission(&lease, &candidate)
        .await
        .unwrap()
        .unwrap();
    // The disconnect removes the account and its work. The journal is independent.
    sqlx::query!("DELETE FROM calendar_accounts WHERE email_link_id=$1", link)
        .execute(&pool)
        .await
        .unwrap();
    let reconnected = calendar(&repo).await;
    assert_ne!(reconnected.id, lease.id);
    assert_eq!(
        repo.away_submissions(&reconnected).await.unwrap()[0].id,
        submitted
    );
    assert!(
        repo.begin_away_submission(&reconnected, &candidate)
            .await
            .unwrap()
            .is_none()
    );
    sqlx::query!("DELETE FROM email_links WHERE id=$1", link)
        .execute(&pool)
        .await
        .unwrap();
    let new_link = insert_link(&pool, &owner).await;
    sqlx::query!("UPDATE email_links SET provider='OUTLOOK',provider_tenant_id='tenant',provider_mailbox_id='mailbox',sync_generation=1,grant_generation=1,is_sync_active=true WHERE id=$1",new_link).execute(&pool).await.unwrap();
    sqlx::query!("INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES($1,1,ARRAY['Calendars.ReadWrite'])",new_link).execute(&pool).await.unwrap();
    let rebound = calendar(&repo).await;
    assert_eq!(
        repo.away_submissions(&rebound).await.unwrap()[0].id,
        submitted
    );
    assert!(
        repo.begin_away_submission(&rebound, &candidate)
            .await
            .unwrap()
            .is_none()
    );
    repo.defer_away_submission(&rebound, submitted)
        .await
        .unwrap();
    assert!(
        repo.begin_away_submission(&rebound, &candidate)
            .await
            .unwrap()
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn automatic_decline_candidates_are_fair_bounded_and_respect_disabled_occurrences(
    pool: PgPool,
) {
    use crate::domain::outlook::automatic_decline::*;
    let (repo, link, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let target = lease.target.as_ref().unwrap();
    let starts = Utc::now() + Duration::days(1);
    let policy = AutomaticDeclinePolicy {
        id: Uuid::now_v7(),
        enabled_at: Utc::now(),
        properties: OutOfOfficeProperties {
            auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations,
            decline_message: None,
        },
    };
    let mut disabled = policy.clone();
    disabled.properties.auto_decline_mode = OutOfOfficeAutoDeclineMode::DeclineNone;
    for n in 0..26 {
        let mut event = reminder_upsert(
            &owner,
            link,
            (lease.account_id, target.calendar_id),
            &format!("candidate-{n}"),
            starts,
            EventReminders::default(),
        );
        let mut source = event.source.details().clone();
        source.binding = Some(lease.binding);
        if n == 0 {
            source.automatic_decline = Some(policy.clone());
            event.event.event_type = EventType::OutOfOffice;
            let time = event.event.time.clone();
            let key = starts.to_rfc3339();
            event.occurrences[0].recurrence_id = Some(key.clone());
            event.overrides.push(CalendarEventOverride {
                reminders: None,
                automatic_decline: Some(disabled.clone()),
                visibility: None,
                transparency: None,
                sequence: None,
                source_updated_at: None,
                recurrence_id: key,
                original_time: EventStart::Timed(starts),
                time,
                title: None,
                description: None,
                location: None,
                status: None,
                attendees: None,
            });
        }
        event.source = CalendarEventSource::Outlook(source);
        repo.upsert_event(CalendarEventWrite::UserMutation(event))
            .await
            .unwrap();
    }
    assert!(repo.away_candidates(&lease).await.unwrap().is_empty());
    // Re-enable the occurrence in this source snapshot; candidates must not use
    // canonical event overrides from a different calendar copy.
    sqlx::query!("UPDATE calendar_event_sources SET normalized_payload=jsonb_set(normalized_payload,'{overrides,0,automaticDecline}',$2) WHERE calendar_id=$1 AND provider_event_id='provider-candidate-0'",target.calendar_id,serde_json::to_value(&policy).unwrap()).execute(&pool).await.unwrap();
    let first = repo.away_candidates(&lease).await.unwrap();
    assert_eq!(first.len(), 20);
    for candidate in &first {
        repo.record_away_check(&lease, candidate, 120)
            .await
            .unwrap();
    }
    let rest = repo.away_candidates(&lease).await.unwrap();
    assert_eq!(rest.len(), 5);
    assert!(
        rest.iter()
            .all(|r| first.iter().all(|f| f.invitation_id != r.invitation_id))
    );
}
