use super::changes::{counter, ops_after};
use super::join_requests::{insert_join_request_notification, recipient_holds};
use super::*;
use crate::domain::models::{
    AutomaticDeclinePolicy, OutOfOfficeAutoDeclineMode, OutOfOfficeProperties,
};
use crate::domain::outlook::*;
use crate::domain::ports::{CalendarProviderErrorKind, CalendarSyncHealthReader};

mod certification;

async fn mailbox(pool: &PgPool) -> (PgCalendarRepository, Uuid, String) {
    let owner = "macro|outlook-owner@example.com".to_owned();
    insert_user(pool, &owner).await;
    let link = outlook_link(pool, &owner).await;
    (PgCalendarRepository::new(pool.clone()), link, owner)
}
async fn outlook_link(pool: &PgPool, owner: &str) -> Uuid {
    let link = insert_link(pool, owner).await;
    sqlx::query!("UPDATE email_links SET provider='OUTLOOK',sync_generation=1,grant_generation=1,is_sync_active=true WHERE id=$1",link).execute(pool).await.unwrap();
    sqlx::query!("INSERT INTO email_link_microsoft_scopes(link_id,grant_generation,granted_scopes) VALUES($1,1,ARRAY['Calendars.ReadWrite'])",link).execute(pool).await.unwrap();
    link
}
/// Each work row's scan identity, which only a reset replaces.
async fn scans(pool: &PgPool, account_id: Uuid) -> Vec<(Uuid, Uuid, i64, i64, Option<String>)> {
    sqlx::query!("SELECT id,scan_id,sync_generation,grant_generation,cursor FROM calendar_outlook_work WHERE account_id=$1 ORDER BY id",account_id)
        .fetch_all(pool).await.unwrap().into_iter()
        .map(|w| (w.id, w.scan_id, w.sync_generation, w.grant_generation, w.cursor))
        .collect()
}
/// The reader revision of the tests' worker.
const READER_REVISION: i16 = 1;

async fn claim(repo: &PgCalendarRepository) -> Option<OutlookCalendarLease> {
    claim_at(repo, READER_REVISION).await
}
async fn claim_at(repo: &PgCalendarRepository, revision: i16) -> Option<OutlookCalendarLease> {
    repo.claim_outlook_calendar(
        Uuid::now_v7(),
        OccurrenceRange::maintenance_horizon(Utc::now()),
        revision,
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
        owner_address: None,
        shared_with_me: false,
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
/// Lists a first import's near window, empty, and claims the scan that lists
/// the whole window, where a calendar is once this month and next are in.
async fn past_near_window(
    repo: &PgCalendarRepository,
    lease: OutlookCalendarLease,
) -> OutlookCalendarLease {
    assert!(
        lease.near_window,
        "a first import lists this month and next first"
    );
    repo.checkpoint_outlook_calendar(&lease, near_page(vec![]))
        .await
        .unwrap();
    let finish = claim(repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    let whole = claim(repo).await.unwrap();
    assert_eq!(whole.id, lease.id);
    assert!(!whole.near_window);
    whole
}
/// Page members, as (provider id, master id), with no listed time.
fn untimed(members: &[(&str, &str)]) -> Vec<OutlookPageMember> {
    members
        .iter()
        .map(|(id, master)| OutlookPageMember {
            provider_id: (*id).into(),
            master_id: (*master).into(),
            occurs: None,
        })
        .collect()
}
/// The last page of a near-window listing, which is a snapshot with no delta link.
fn near_page(members: Vec<(&str, &str)>) -> OutlookCalendarProgress {
    OutlookCalendarProgress::Page(OutlookCalendarPage {
        members: untimed(&members),
        removed: vec![],
        next: None,
        delta: None,
    })
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
    assert!(
        claim(&repo).await.is_none(),
        "one item per account at a time"
    );
    repo.checkpoint_outlook_calendar(&first, near_page(vec![]))
        .await
        .unwrap();
    let second = claim(&repo).await.unwrap();
    assert_ne!(
        first.target.as_ref().unwrap().calendar_id,
        second.target.as_ref().unwrap().calendar_id
    );
    assert!(claim(&repo).await.is_none());
    repo.checkpoint_outlook_calendar(&second, near_page(vec![]))
        .await
        .unwrap();

    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '1 minute' WHERE id=$1",
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
        assert!(row.lease_id.is_none());
    }
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
        .claim_projections(Uuid::now_v7(), 1)
        .await
        .unwrap()
        .remove(0);
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
    .unwrap()
    .row;
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
        .claim_projections(Uuid::now_v7(), 1)
        .await
        .unwrap()
        .remove(0);
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
        .claim_projections(Uuid::now_v7(), 1)
        .await
        .unwrap()
        .remove(0);
    sqlx::query!(
        "UPDATE calendar_events SET title='New title' WHERE id=$1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    repo.complete_projection(&old).await.unwrap();
    let new = repo
        .claim_projections(Uuid::now_v7(), 1)
        .await
        .unwrap()
        .remove(0);
    assert!(new.revision > old.revision);
    assert_eq!(new.event_id, id);
    repo.complete_projection(&new).await.unwrap();
    assert!(
        repo.claim_projections(Uuid::now_v7(), 1)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_batch_claims_up_to_its_limit_under_one_lease(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    store(&repo, &lease, "first").await;
    store(&repo, &lease, "second").await;
    store(&repo, &lease, "third").await;
    let batch = repo.claim_projections(Uuid::now_v7(), 2).await.unwrap();
    assert_eq!(batch.len(), 2);
    assert_eq!(batch[0].lease_id, batch[1].lease_id, "one lease");
    let rest = repo.claim_projections(Uuid::now_v7(), 2).await.unwrap();
    assert_eq!(rest.len(), 1, "a leased change is not claimed twice");
    for lease in batch.iter().chain(&rest) {
        repo.complete_projection(lease).await.unwrap();
    }
    assert!(
        repo.claim_projections(Uuid::now_v7(), 100)
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn projection_claims_take_due_changes_in_order_and_skip_backed_off_ones(pool: PgPool) {
    let (repo, link, owner) = mailbox(&pool).await;
    let [later, second, first] = [Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7()];
    sqlx::query!(
        "INSERT INTO calendar_projection_outbox(event_id,owner_id,link_id,change_kind,next_run_at) VALUES
            ($1,$4,$5,'created',now() + interval '1 hour'),
            ($2,$4,$5,'updated',now() - interval '1 minute'),
            ($3,$4,$5,'deleted',now() - interval '2 minutes')",
        later,
        second,
        first,
        owner,
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut claimed = Vec::new();
    while let Some(lease) = repo
        .claim_projections(Uuid::now_v7(), 1)
        .await
        .unwrap()
        .pop()
    {
        claimed.push(lease.event_id);
    }
    assert_eq!(claimed, [first, second]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn publications_name_only_changes_that_touch_an_out_of_office_event(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let id = store(&repo, &lease, "changing").await;
    let publish = async || {
        let lease = repo
            .claim_projections(Uuid::now_v7(), 1)
            .await
            .unwrap()
            .remove(0);
        repo.complete_projection(&lease).await.unwrap();
        assert!(
            repo.claim_projections(Uuid::now_v7(), 1)
                .await
                .unwrap()
                .is_empty()
        );
        lease.team_ooo_changed
    };
    assert!(!publish().await, "a meeting's import");

    sqlx::query!(
        "UPDATE calendar_events SET event_type='out_of_office' WHERE id=$1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(publish().await, "it becomes out of office");

    sqlx::query!("UPDATE calendar_events SET title='Away' WHERE id=$1", id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(publish().await, "a change while it is out of office");

    sqlx::query!(
        "UPDATE calendar_events SET event_type='default' WHERE id=$1",
        id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("UPDATE calendar_events SET title='Back' WHERE id=$1", id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        publish().await,
        "a waiting revision keeps the hint of every change it carries"
    );

    sqlx::query!("UPDATE calendar_events SET title='Meeting' WHERE id=$1", id)
        .execute(&pool)
        .await
        .unwrap();
    assert!(!publish().await, "a meeting's change");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn discovery_reports_calendar_changes_as_google_does(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let discover = async |calendars: Vec<OutlookCalendar>| {
        // The discovery is due again before any calendar's own round.
        sqlx::query!(
            "UPDATE calendar_outlook_work SET next_run_at=CASE WHEN calendar_id IS NULL THEN now()-interval '1 minute' ELSE now()+interval '1 hour' END"
        )
        .execute(&pool)
        .await
        .unwrap();
        let discovery = claim(&repo).await.unwrap();
        assert!(discovery.target.is_none());
        repo.commit_outlook_calendars(&discovery, calendars)
            .await
            .unwrap()
    };
    assert_eq!(
        discover(vec![
            discovered_calendar("primary"),
            discovered_calendar("secondary")
        ])
        .await,
        OutlookCalendarsChange {
            changed: true,
            team_ooo_changed: true
        },
        "new calendars"
    );
    assert_eq!(
        discover(vec![
            discovered_calendar("primary"),
            discovered_calendar("secondary")
        ])
        .await,
        OutlookCalendarsChange::default(),
        "the same calendars"
    );

    let mut without_teams = discovered_calendar("secondary");
    without_teams.online_meeting_providers = vec![];
    assert_eq!(
        discover(vec![discovered_calendar("primary"), without_teams]).await,
        OutlookCalendarsChange {
            changed: true,
            team_ooo_changed: false
        },
        "a calendar that can no longer add Teams meetings"
    );

    let mut renamed = discovered_calendar("secondary");
    renamed.calendar.name = "Renamed".into();
    assert_eq!(
        discover(vec![discovered_calendar("primary"), renamed]).await,
        OutlookCalendarsChange {
            changed: true,
            team_ooo_changed: true
        },
        "a renamed calendar"
    );
    assert_eq!(
        discover(vec![discovered_calendar("primary")]).await,
        OutlookCalendarsChange {
            changed: true,
            team_ooo_changed: false
        },
        "a removed calendar, whose events each announce their own retirement"
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
    let lease = past_near_window(&repo, calendar(&repo).await).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[
                ("provider-one", "provider-one"),
                ("provider-two", "provider-two"),
            ]),
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

/// What readers of a calendar's coverage see: when it last synced, from where
/// its window is materialized, and its account's state.
async fn coverage(
    pool: &PgPool,
    calendar_id: Uuid,
) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>, String, bool) {
    let row = sqlx::query!(
        r#"SELECT c.synced_at, c.materialized_starts_at, a.sync_status::text AS "sync_status!", a.last_synced_at IS NOT NULL AS "account_synced!"
        FROM calendars c JOIN calendar_accounts a ON a.id = c.account_id WHERE c.id = $1"#,
        calendar_id
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (
        row.synced_at,
        row.materialized_starts_at,
        row.sync_status,
        row.account_synced,
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_first_import_lists_this_month_and_next_before_the_whole_window(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    assert!(
        lease.near_window,
        "a calendar never synced lists this month and next first"
    );
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;
    repo.checkpoint_outlook_calendar(
        &lease,
        near_page(vec![("near-occurrence", "provider-near")]),
    )
    .await
    .unwrap();
    let event = claim(&repo).await.unwrap();
    assert!(event.near_window);
    let near = store(&repo, &event, "near").await;
    repo.checkpoint_outlook_calendar(
        &event,
        OutlookCalendarProgress::Event {
            id: "provider-near".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    assert_eq!(
        repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
            .await
            .unwrap(),
        OutlookCheckpoint::NearWindowImported
    );

    // This month and next are imported, and nothing reads the rest of the
    // window as imported or as free time yet.
    assert!(
        repo.get_event_mutation_target(&owner, near, None)
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(
        coverage(&pool, calendar_id).await,
        (None, None, "syncing".into(), false),
        "the calendar is unsynced, its window unmaterialized and its account syncing"
    );
    let health = repo.calendar_sync_health(&owner).await.unwrap();
    assert_eq!(
        health
            .calendars
            .iter()
            .find(|freshness| freshness.calendar_id == calendar_id)
            .unwrap()
            .refresh_due_at,
        None,
        "booking still waits for the first sync"
    );

    let whole = claim(&repo).await.unwrap();
    assert_eq!(whole.id, lease.id, "the whole window is listed right after");
    assert!(!whole.near_window);
    assert!(whole.page_cursor.is_none(), "from its first page");
    repo.checkpoint_outlook_calendar(
        &whole,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[
                ("near-occurrence", "provider-near"),
                ("old-occurrence", "provider-old"),
            ]),
            removed: vec![],
            next: None,
            delta: Some("terminal".into()),
        }),
    )
    .await
    .unwrap();
    for (id, uid) in [("provider-near", "near"), ("provider-old", "old")] {
        let event = claim(&repo).await.unwrap();
        assert_eq!(event.pending_ids.first().map(String::as_str), Some(id));
        store(&repo, &event, uid).await;
        repo.checkpoint_outlook_calendar(
            &event,
            OutlookCalendarProgress::Event {
                id: id.into(),
                exists: true,
            },
        )
        .await
        .unwrap();
    }
    let finish = claim(&repo).await.unwrap();
    assert_eq!(
        repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
            .await
            .unwrap(),
        OutlookCheckpoint::RoundFinished {
            first_sync: true,
            cleared_sync_error: false
        }
    );
    let (synced_at, materialized_from, status, account_synced) = coverage(&pool, calendar_id).await;
    assert!(synced_at.is_some(), "synced once the whole window is in");
    assert_eq!(
        materialized_from,
        Some(whole.target.as_ref().unwrap().range.starts_at)
    );
    assert_eq!((status.as_str(), account_synced), ("ready", true));

    // A synced calendar never lists the near window again, even from scratch.
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let delta = claim(&repo).await.unwrap();
    assert!(!delta.near_window);
    repo.checkpoint_outlook_calendar(&delta, delta_page("second"))
        .await
        .unwrap();
    let finish = claim(&repo).await.unwrap();
    assert_eq!(
        repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
            .await
            .unwrap(),
        OutlookCheckpoint::RoundFinished {
            first_sync: false,
            cleared_sync_error: false
        },
        "a later round is not a first sync"
    );
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let delta = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&delta, OutlookCalendarProgress::Reset)
        .await
        .unwrap();
    let rebuilt = claim(&repo).await.unwrap();
    assert!(
        rebuilt.cursor.is_none(),
        "the reset starts a scan from scratch"
    );
    assert!(!rebuilt.near_window);
}

/// A page member listed `days` from now, an hour long.
fn timed(id: &str, master: &str, days: i64) -> OutlookPageMember {
    let starts_at = Utc::now() + chrono::Duration::days(days);
    OutlookPageMember {
        provider_id: id.into(),
        master_id: master.into(),
        occurs: Some((starts_at, starts_at + chrono::Duration::hours(1))),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_first_imports_near_window_reads_the_events_closest_to_today_first(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    assert!(lease.near_window);
    let listed = || {
        vec![
            OutlookPageMember {
                occurs: None,
                ..timed("0-untimed", "0-untimed", 0)
            },
            timed("a-next-month", "a-next-month", 25),
            timed("b-tomorrow", "b-tomorrow", 1),
            timed("c-later", "c-series", 40),
            timed("c-two-days-ago", "c-series", -2),
        ]
    };
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: listed(),
            removed: vec![],
            next: None,
            delta: None,
        }),
    )
    .await
    .unwrap();

    let nearest = ["b-tomorrow", "c-series", "a-next-month", "0-untimed"];
    for (read, id) in nearest.iter().enumerate() {
        let event = claim(&repo).await.unwrap();
        assert_eq!(
            event.pending_ids,
            nearest[read..],
            "tomorrow first, then a series by its nearest occurrence, next month, and an untimed event last"
        );
        repo.checkpoint_outlook_calendar(
            &event,
            OutlookCalendarProgress::Event {
                id: (*id).into(),
                exists: true,
            },
        )
        .await
        .unwrap();
    }
    let finish = claim(&repo).await.unwrap();
    assert_eq!(
        repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
            .await
            .unwrap(),
        OutlookCheckpoint::NearWindowImported
    );

    let whole = claim(&repo).await.unwrap();
    assert!(!whole.near_window);
    repo.checkpoint_outlook_calendar(
        &whole,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: listed(),
            removed: vec![],
            next: None,
            delta: Some("terminal".into()),
        }),
    )
    .await
    .unwrap();
    assert_eq!(
        claim(&repo).await.unwrap().pending_ids,
        ["0-untimed", "a-next-month", "b-tomorrow", "c-series"],
        "the whole window reads in ID order, as every round after a first import's near window does"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_gone_before_the_whole_window_is_listed_leaves_the_first_import(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        near_page(vec![("gone-occurrence", "provider-gone")]),
    )
    .await
    .unwrap();
    let event = claim(&repo).await.unwrap();
    let gone = store(&repo, &event, "gone").await;
    repo.checkpoint_outlook_calendar(
        &event,
        OutlookCalendarProgress::Event {
            id: "provider-gone".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    let finish = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap();

    // Deleted in Outlook before the whole window is listed.
    let whole = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&whole, delta_page("terminal"))
        .await
        .unwrap();
    finish_round(&repo, &pool, READER_REVISION).await;
    assert!(
        repo.get_event_mutation_target(&owner, gone, None)
            .await
            .unwrap()
            .is_none(),
        "only the whole-window listing decides what the calendar keeps"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn tombstones_refresh_known_series_and_reset_unknown_history(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[("occurrence", "provider-series")]),
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

fn delta_page(cursor: &str) -> OutlookCalendarProgress {
    OutlookCalendarProgress::Page(OutlookCalendarPage {
        members: vec![],
        removed: vec![],
        next: None,
        delta: Some(cursor.into()),
    })
}

async fn finish_round(repo: &PgCalendarRepository, pool: &PgPool, revision: i16) {
    let lease = claim_at(repo, revision).await.unwrap();
    assert!(lease.pending_ids.is_empty());
    repo.checkpoint_outlook_calendar(&lease, OutlookCalendarProgress::Finish)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now() WHERE id=$1",
        lease.id
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_delta_round_reads_again_only_events_an_older_reader_skipped(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = past_near_window(&repo, calendar(&repo).await).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[
                ("kept", "provider-kept"),
                ("skipped-occurrence", "provider-skipped"),
                ("unstamped-occurrence", "provider-unstamped"),
            ]),
            removed: vec![],
            next: None,
            delta: Some("baseline".into()),
        }),
    )
    .await
    .unwrap();
    let event = claim(&repo).await.unwrap();
    store(&repo, &event, "kept").await;
    repo.checkpoint_outlook_calendar(
        &event,
        OutlookCalendarProgress::Event {
            id: "provider-kept".into(),
            exists: true,
        },
    )
    .await
    .unwrap();
    for id in ["provider-skipped", "provider-unstamped"] {
        let event = claim(&repo).await.unwrap();
        repo.checkpoint_outlook_calendar(
            &event,
            OutlookCalendarProgress::Unreadable { id: id.into() },
        )
        .await
        .unwrap();
    }
    finish_round(&repo, &pool, READER_REVISION).await;
    // What a build before reader revisions left behind.
    sqlx::query!("UPDATE calendar_outlook_members SET reader_revision=NULL WHERE master_id IN ('provider-kept','provider-unstamped')")
        .execute(&pool)
        .await
        .unwrap();

    let delta = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&delta, delta_page("second"))
        .await
        .unwrap();
    let reread = claim(&repo).await.unwrap();
    assert_eq!(
        reread.pending_ids,
        ["provider-unstamped"],
        "a stored event and one this revision skipped are not read again"
    );
    let kept = sqlx::query_scalar!(
        "SELECT reader_revision FROM calendar_outlook_members WHERE master_id='provider-kept'"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        kept,
        Some(READER_REVISION),
        "a stored event is stamped as it is checked, so later pages skip it"
    );
    repo.checkpoint_outlook_calendar(
        &reread,
        OutlookCalendarProgress::Unreadable {
            id: "provider-unstamped".into(),
        },
    )
    .await
    .unwrap();
    finish_round(&repo, &pool, READER_REVISION).await;

    let delta = claim(&repo).await.unwrap();
    repo.checkpoint_outlook_calendar(&delta, delta_page("third"))
        .await
        .unwrap();
    finish_round(&repo, &pool, READER_REVISION).await;

    let later = READER_REVISION + 1;
    let delta = claim_at(&repo, later).await.unwrap();
    repo.checkpoint_outlook_calendar(&delta, delta_page("fourth"))
        .await
        .unwrap();
    let reread = claim_at(&repo, later).await.unwrap();
    assert_eq!(
        reread.pending_ids,
        ["provider-skipped", "provider-unstamped"],
        "a later revision reads again what older ones skipped"
    );

    repo.checkpoint_outlook_calendar(&reread, OutlookCalendarProgress::Reset)
        .await
        .unwrap();
    let scan = claim_at(&repo, later).await.unwrap();
    repo.checkpoint_outlook_calendar(&scan, delta_page("rescanned"))
        .await
        .unwrap();
    let listed = claim_at(&repo, later).await.unwrap();
    assert!(
        listed.page_loaded && listed.pending_ids.is_empty(),
        "a full scan reads only what it lists"
    );
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
async fn replaced_generations_reset_each_work_row_exactly_once(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.commit_outlook_calendar(&lease, Some(vec![]), Some("cursor".into()))
        .await
        .unwrap();
    let settled = scans(&pool, lease.account_id).await;
    assert_eq!(settled.len(), 2);
    assert!(claim(&repo).await.is_none());
    assert_eq!(scans(&pool, lease.account_id).await, settled);

    // A newer link generation sorts above the work's, an older one below it.
    sqlx::query!("UPDATE email_links SET sync_generation=2 WHERE id=$1", link)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_outlook_work SET grant_generation=5 WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(claim(&repo).await.is_some());
    let reset = scans(&pool, lease.account_id).await;
    for (before, after) in settled.iter().zip(&reset) {
        assert_ne!(after.1, before.1);
        assert_eq!((after.2, after.3, after.4.as_deref()), (2, 1, None));
    }
    while claim(&repo).await.is_some() {}
    assert_eq!(scans(&pool, lease.account_id).await, reset);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn month_rollover_resets_only_expired_windows_once(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    repo.commit_outlook_calendar(&lease, Some(vec![]), Some("cursor".into()))
        .await
        .unwrap();
    let settled = scans(&pool, lease.account_id).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET ends_at=ends_at-interval '1 month' WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let rolled = claim(&repo).await.unwrap();
    assert_eq!(rolled.id, lease.id);
    assert!(rolled.cursor.is_none());
    assert_eq!(
        rolled.target.unwrap().range.ends_at,
        OccurrenceRange::maintenance_horizon(Utc::now()).ends_at
    );
    let reset = scans(&pool, lease.account_id).await;
    for (before, after) in settled.iter().zip(&reset) {
        assert_eq!(after.1 == before.1, after.0 != lease.id);
    }
    sqlx::query!(
        "UPDATE calendar_outlook_work SET lease_until=now()-interval '1 second' WHERE id=$1",
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(claim(&repo).await.is_some());
    assert_eq!(scans(&pool, lease.account_id).await, reset);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unclaimable_accounts_never_starve_claimable_work(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let [reauth, revoked, inactive] = [
        outlook_link(&pool, &owner).await,
        outlook_link(&pool, &owner).await,
        outlook_link(&pool, &owner).await,
    ];
    while claim(&repo).await.is_some() {}
    let deleted = repo
        .upsert_calendar_fixture(lease.account_id, discovered_calendar("deleted").calendar)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO calendar_outlook_work(id,account_id,calendar_id,sync_generation,grant_generation,starts_at,ends_at)
            SELECT $1,account_id,$2,sync_generation,grant_generation,starts_at,ends_at FROM calendar_outlook_work WHERE id=$3",
        Uuid::now_v7(),
        deleted,
        lease.id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!("UPDATE calendars SET is_deleted=true WHERE id=$1", deleted)
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE calendar_accounts SET sync_status='reauth_required' WHERE email_link_id=$1",
        reauth
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "DELETE FROM email_link_microsoft_scopes WHERE link_id=$1",
        revoked
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false WHERE id=$1",
        inactive
    )
    .execute(&pool)
    .await
    .unwrap();
    // Every unclaimable row is due long before the one claimable row.
    sqlx::query!(
        "UPDATE calendar_outlook_work SET lease_id=NULL,lease_until=NULL,
            next_run_at=CASE WHEN id=$1 THEN now()-interval '1 minute' WHEN account_id=$2 AND calendar_id IS NULL THEN now()+interval '1 hour' ELSE now()-interval '1 day' END",
        lease.id,
        lease.account_id
    )
    .execute(&pool)
    .await
    .unwrap();

    assert_eq!(claim(&repo).await.unwrap().id, lease.id);
    assert!(claim(&repo).await.is_none());
    let status = |link: Uuid| {
        let pool = pool.clone();
        async move {
            sqlx::query_scalar!(
                "SELECT sync_status FROM calendar_accounts WHERE email_link_id=$1",
                link
            )
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };
    assert_eq!(status(reauth).await, "reauth_required");
    assert_eq!(status(revoked).await, "disabled");
    assert_eq!(status(inactive).await, "disabled");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn claims_take_due_work_in_order_across_accounts(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    for _ in 0..2 {
        outlook_link(&pool, &owner).await;
    }
    let mut discovered = vec![];
    while let Some(lease) = claim(&repo).await {
        discovered.push(lease.id);
    }
    assert_eq!(discovered.len(), 3);
    for (minutes, id) in [3, 1, 2].into_iter().zip(&discovered) {
        sqlx::query!(
            "UPDATE calendar_outlook_work SET lease_id=NULL,lease_until=NULL,next_run_at=now()-make_interval(mins=>$2) WHERE id=$1",
            id,
            minutes
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    let mut claimed = vec![];
    while let Some(lease) = claim(&repo).await {
        claimed.push(lease.id);
    }
    assert_eq!(claimed, [discovered[0], discovered[2], discovered[1]]);
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

/// The migration that stores Outlook organizers, whom Graph lists as not
/// having answered, as holding their meetings.
const OUTLOOK_ORGANIZERS_HOLD_THEIR_MEETINGS: &str = include_str!(
    "../../../../../macro_db_client/migrations/20261026191007_outlook_organizers_hold_their_meetings.sql"
);

fn unanswered(email: &str, is_organizer: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: email.into(),
        display_name: None,
        response_status: AttendeeResponseStatus::NeedsAction,
        is_organizer,
        is_optional: false,
        is_self: false,
        comment: None,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_organizer_repair_stores_outlook_organizers_as_holding_their_meetings(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    // How sync stored a series Macro created before October 2026: the
    // organizer unanswered on the series and on its one exception.
    let mut stored = upsert(&lease, "made-by-macro@example.com");
    stored.event.organizer_email = Some("owner@example.com".into());
    let guests = vec![
        unanswered("owner@example.com", true),
        unanswered("ada@example.com", false),
    ];
    stored.event.attendees = guests.clone();
    let moved = stored.occurrences[1].clone();
    let EventTime::Timed {
        starts_at: moved_start,
        ..
    } = moved.time
    else {
        panic!("the fixture's occurrences are timed");
    };
    stored.overrides = vec![CalendarEventOverride {
        reminders: None,
        automatic_decline: None,
        sequence: None,
        source_updated_at: None,
        recurrence_id: moved.occurrence_key.clone(),
        original_time: EventStart::Timed(moved_start),
        time: moved.time.clone(),
        title: Some("Moved".into()),
        description: None,
        location: None,
        status: None,
        visibility: None,
        transparency: None,
        attendees: Some(guests),
    }];
    let event_id = repo
        .upsert_event(CalendarEventWrite::OutlookSync {
            lease: Box::new(lease.clone()),
            upsert: stored,
        })
        .await
        .unwrap()
        .event_id;
    let counter = || async {
        sqlx::query_scalar!(
            "SELECT seq FROM calendar_change_counters WHERE link_id = $1",
            link,
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    let before = counter().await;

    sqlx::raw_sql(OUTLOOK_ORGANIZERS_HOLD_THEIR_MEETINGS)
        .execute(&pool)
        .await
        .unwrap();

    let rows = sqlx::query!(
        r#"
        SELECT email, response_status, 'series' AS "scope!"
        FROM calendar_event_attendees WHERE event_id = $1
        UNION ALL
        SELECT email, response_status, 'exception'
        FROM calendar_event_override_attendees WHERE event_id = $1
        ORDER BY 3 DESC, 1
        "#,
        event_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.scope, row.email.unwrap(), row.response_status.unwrap()))
    .collect::<Vec<_>>();
    let expected = |scope: &str| {
        [
            (
                scope.to_string(),
                "ada@example.com".to_string(),
                "needs_action".to_string(),
            ),
            (
                scope.to_string(),
                "owner@example.com".to_string(),
                "accepted".to_string(),
            ),
        ]
    };
    assert_eq!(rows, [expected("series"), expected("exception")].concat());
    let payload = sqlx::query_scalar!(
        "SELECT normalized_payload FROM calendar_event_sources WHERE event_id = $1",
        event_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    for attendees in [
        &payload["event"]["attendees"],
        &payload["overrides"][0]["attendees"],
    ] {
        assert_eq!(
            attendees
                .as_array()
                .unwrap()
                .iter()
                .map(|attendee| attendee["responseStatus"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["accepted", "needs_action"],
            "the projection a restore would replay agrees: {attendees}"
        );
    }
    let logged = sqlx::query!(
        "SELECT seq, kind, event_id FROM calendar_change_log WHERE link_id = $1 AND seq > $2",
        link,
        before,
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.seq, row.kind, row.event_id))
    .collect::<Vec<_>>();
    assert_eq!(logged, [(before + 1, 1, Some(event_id))]);

    sqlx::raw_sql(OUTLOOK_ORGANIZERS_HOLD_THEIR_MEETINGS)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        counter().await,
        before + 1,
        "a rerun finds nothing left to fix"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_outlook_cancellation_or_removal_retires_join_request_notifications(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let member = "macro|outlook-member@example.com";
    insert_user(&pool, member).await;
    let lease = calendar(&repo).await;
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[("provider-removed", "provider-removed")]),
            removed: vec![],
            next: None,
            delta: Some("baseline".into()),
        }),
    )
    .await
    .unwrap();
    let event = claim(&repo).await.unwrap();
    let cancelled_id = store(&repo, &event, "cancelled").await;
    let removed_id = store(&repo, &event, "removed").await;
    let (request, _) = repo
        .open_join_request(cancelled_id, member, "member@work.example.com")
        .await
        .unwrap();
    let (removed_request, _) = repo
        .open_join_request(removed_id, member, "member@work.example.com")
        .await
        .unwrap();
    let on_cancelled = insert_join_request_notification(&pool, &request, &[&owner]).await;
    let on_removed = insert_join_request_notification(&pool, &removed_request, &[&owner]).await;

    // Outlook can keep a cancelled meeting: the row stays, with its request.
    let mut cancelled = upsert(&event, "cancelled");
    cancelled.event.status = EventStatus::Cancelled;
    cancelled.event.sequence = 1;
    cancelled.event.updated_at += Duration::minutes(1);
    repo.upsert_event(CalendarEventWrite::OutlookSync {
        lease: Box::new(event.clone()),
        upsert: cancelled,
    })
    .await
    .unwrap();
    assert!(!recipient_holds(&pool, on_cancelled).await);
    assert_eq!(
        repo.get_join_request(request.id).await.unwrap(),
        Some(request)
    );
    assert!(recipient_holds(&pool, on_removed).await);

    repo.checkpoint_outlook_calendar(
        &event,
        OutlookCalendarProgress::Event {
            id: "provider-removed".into(),
            exists: false,
        },
    )
    .await
    .unwrap();
    assert!(!recipient_holds(&pool, on_removed).await);
}

/// Makes a released work row due before any other and claims it.
async fn reclaim(
    pool: &PgPool,
    repo: &PgCalendarRepository,
    work_id: Uuid,
) -> OutlookCalendarLease {
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '1 day' WHERE id=$1",
        work_id
    )
    .execute(pool)
    .await
    .unwrap();
    let lease = claim(repo).await.unwrap();
    assert_eq!(lease.id, work_id);
    lease
}

/// Fails a primary calendar's sync `times` times with `kind`, reclaiming it
/// after each failure, and returns the next lease with whether each failure
/// showed or changed the badge.
async fn fail_times(
    pool: &PgPool,
    repo: &PgCalendarRepository,
    mut lease: OutlookCalendarLease,
    kind: CalendarProviderErrorKind,
    times: i32,
) -> (OutlookCalendarLease, Vec<bool>) {
    let mut badge_changes = Vec::new();
    for _ in 0..times {
        badge_changes.push(repo.fail_outlook_calendar(&lease, kind).await.unwrap());
        lease = reclaim(pool, repo, lease.id).await;
    }
    (lease, badge_changes)
}

/// Runs one clean round of a primary calendar: the near window when its first
/// import has not listed it yet, its last page, then the finish, whose
/// checkpoint it returns.
async fn clean_round(
    repo: &PgCalendarRepository,
    lease: &OutlookCalendarLease,
) -> OutlookCheckpoint {
    let lease = &if lease.near_window {
        past_near_window(repo, lease.clone()).await
    } else {
        lease.clone()
    };
    repo.checkpoint_outlook_calendar(
        lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: vec![],
            removed: vec![],
            next: None,
            delta: Some("terminal".into()),
        }),
    )
    .await
    .unwrap();
    let finish = claim(repo).await.unwrap();
    assert_eq!(finish.id, lease.id);
    repo.checkpoint_outlook_calendar(&finish, OutlookCalendarProgress::Finish)
        .await
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_outlook_sync_error_badge_logs_when_it_appears_and_when_it_changes(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;
    let before = counter(&pool, link).await;

    let (lease, shown) = fail_times(
        &pool,
        &repo,
        lease,
        CalendarProviderErrorKind::Permanent,
        CALENDAR_SYNC_FAILURE_BADGE_THRESHOLD + 1,
    )
    .await;
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "only the failure that crosses the threshold shows a badge"
    );
    assert_eq!(
        shown,
        [false, false, true, false],
        "viewers hear of the failure that shows the badge"
    );

    let (lease, reworded) =
        fail_times(&pool, &repo, lease, CalendarProviderErrorKind::Transient, 2).await;
    assert!(
        repo.fail_outlook_calendar(&lease, CalendarProviderErrorKind::ReauthRequired)
            .await
            .unwrap()
    );
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id); 3],
        "each reworded badge logs once; a repeat of the shown one does not"
    );
    assert_eq!(reworded, [true, false]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_clean_outlook_round_logs_a_cleared_badge_once(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;
    let (lease, _) = fail_times(
        &pool,
        &repo,
        lease,
        CalendarProviderErrorKind::Permanent,
        CALENDAR_SYNC_FAILURE_BADGE_THRESHOLD,
    )
    .await;
    let before = counter(&pool, link).await;

    let stored_kind = || async {
        sqlx::query_scalar!(
            "SELECT last_sync_error_kind FROM calendars WHERE id = $1",
            calendar_id
        )
        .fetch_one(&pool)
        .await
        .unwrap()
    };
    assert_eq!(stored_kind().await.as_deref(), Some("permanent"));

    assert!(
        matches!(
            clean_round(&repo, &lease).await,
            OutlookCheckpoint::RoundFinished {
                cleared_sync_error: true,
                ..
            }
        ),
        "viewers hear of the round that clears a shown badge"
    );
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "the round that clears a shown badge logs it"
    );
    assert_eq!(stored_kind().await, None);

    let routine = OutlookCheckpoint::RoundFinished {
        first_sync: false,
        cleared_sync_error: false,
    };
    let lease = reclaim(&pool, &repo, lease.id).await;
    assert_eq!(clean_round(&repo, &lease).await, routine);
    let lease = reclaim(&pool, &repo, lease.id).await;
    let (lease, _) = fail_times(
        &pool,
        &repo,
        lease,
        CalendarProviderErrorKind::Permanent,
        CALENDAR_SYNC_FAILURE_BADGE_THRESHOLD - 1,
    )
    .await;
    assert_eq!(
        clean_round(&repo, &lease).await,
        routine,
        "an error that never showed clears quietly"
    );
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "routine rounds and an error that never showed log nothing"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnecting_clears_a_reauth_badge_through_the_change_log(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;
    let before = counter(&pool, link).await;
    let (lease, _) = fail_times(
        &pool,
        &repo,
        lease,
        CalendarProviderErrorKind::Permanent,
        CALENDAR_SYNC_FAILURE_BADGE_THRESHOLD - 1,
    )
    .await;
    repo.fail_outlook_calendar(&lease, CalendarProviderErrorKind::ReauthRequired)
        .await
        .unwrap();
    assert!(
        claim(&repo).await.is_none(),
        "reauthorization parks the account"
    );
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id)],
        "the reauthorization failure shows the badge"
    );

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
    assert!(catalog.target.is_none());
    repo.commit_outlook_calendars(&catalog, vec![discovered_calendar("primary")])
        .await
        .unwrap();
    let lease = claim(&repo).await.unwrap();
    assert_eq!(lease.target.as_ref().unwrap().calendar_id, calendar_id);
    assert!(
        matches!(
            clean_round(&repo, &lease).await,
            OutlookCheckpoint::RoundFinished {
                cleared_sync_error: true,
                ..
            }
        ),
        "viewers hear of the reconnect clearing the badge"
    );
    assert_eq!(
        ops_after(&pool, link, before).await,
        vec![CalendarChangeOp::UpsertCalendar(calendar_id); 2],
        "the first clean round on the new grant clears the badge"
    );
}

/// The migration that logs every visible Outlook calendar, so caches that
/// missed a change to its sync error badge refetch it.
const LOG_OUTLOOK_CALENDARS: &str = include_str!(
    "../../../../../macro_db_client/migrations/20261105002046_log_outlook_calendars_for_their_sync_error.sql"
);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_badge_backfill_logs_every_visible_outlook_calendar(pool: PgPool) {
    let (repo, link, owner) = mailbox(&pool).await;
    let discovery = claim(&repo).await.unwrap();
    repo.commit_outlook_calendars(
        &discovery,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("shared"),
            discovered_calendar("removed"),
        ],
    )
    .await
    .unwrap();
    let discovery = reclaim(&pool, &repo, discovery.id).await;
    repo.commit_outlook_calendars(
        &discovery,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("shared"),
        ],
    )
    .await
    .unwrap();
    let google_link = insert_link(&pool, &owner).await;
    provider_ids(&repo, google_link).await;
    let visible = sqlx::query_scalar!(
        r#"SELECT c.id FROM calendars c JOIN calendar_accounts a ON a.id=c.account_id
        WHERE a.email_link_id=$1 AND NOT c.is_deleted ORDER BY c.id"#,
        link
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(visible.len(), 2);
    let before = counter(&pool, link).await;
    let google_before = counter(&pool, google_link).await;

    sqlx::raw_sql(LOG_OUTLOOK_CALENDARS)
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(
        ops_after(&pool, link, before).await,
        visible
            .into_iter()
            .map(CalendarChangeOp::UpsertCalendar)
            .collect::<Vec<_>>(),
        "each visible Outlook calendar logs once; a removed one does not"
    );
    assert_eq!(counter(&pool, link).await, before + 2);
    assert_eq!(
        ops_after(&pool, google_link, google_before).await,
        Vec::<CalendarChangeOp>::new(),
        "Google calendars already log their badge"
    );
}

/// Discovers `primary` and `secondary` for the mailbox's account, and returns
/// the account.
async fn two_calendars(repo: &PgCalendarRepository) -> Uuid {
    let discovery = claim(repo).await.unwrap();
    assert!(discovery.target.is_none());
    repo.commit_outlook_calendars(
        &discovery,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("secondary"),
        ],
    )
    .await
    .unwrap();
    discovery.account_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_account_with_a_live_lease_gives_no_second_item(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    let busy = two_calendars(&repo).await;
    outlook_link(&pool, &owner).await;

    let first = claim(&repo).await.unwrap();
    assert_eq!(first.account_id, busy);
    let other = claim(&repo).await.unwrap();
    assert_ne!(
        other.account_id, busy,
        "the busy account's second calendar waits, so the next loop takes another account"
    );
    assert!(
        claim(&repo).await.is_none(),
        "both accounts hold a lease, although the busy one has a calendar due"
    );
    assert_eq!(
        repo.outlook_queue_depth().await.unwrap().due_items,
        1,
        "the waiting calendar still counts as queued"
    );

    repo.checkpoint_outlook_calendar(&first, near_page(vec![]))
        .await
        .unwrap();
    let next = claim(&repo).await.unwrap();
    assert_eq!(
        next.account_id, busy,
        "a released lease lets the account's next item go"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deferred_claim_waits_without_counting_a_failure(pool: PgPool) {
    let (repo, _, _) = mailbox(&pool).await;
    let lease = calendar(&repo).await;
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;

    repo.defer_outlook_calendar(&lease, std::time::Duration::from_secs(30))
        .await
        .unwrap();

    let work = sqlx::query!(
        r#"SELECT lease_id,lease_until,attempts,last_error,
            extract(epoch FROM next_run_at-now())::float8 AS "wait!" FROM calendar_outlook_work WHERE id=$1"#,
        lease.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(work.lease_id.is_none() && work.lease_until.is_none());
    assert!((25.0..=30.0).contains(&work.wait), "waits {}", work.wait);
    assert_eq!((work.attempts, work.last_error), (0, None));
    let calendar = sqlx::query!(
        r#"SELECT c.consecutive_sync_failures,c.last_sync_error,a.sync_status FROM calendars c
        JOIN calendar_accounts a ON a.id=c.account_id WHERE c.id=$1"#,
        calendar_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        (
            calendar.consecutive_sync_failures,
            calendar.last_sync_error,
            calendar.sync_status.as_str()
        ),
        (0, None, "syncing"),
        "nothing reached Microsoft, so nothing failed"
    );
    assert!(claim(&repo).await.is_none(), "it waits out the delay");
    assert!(
        repo.defer_outlook_calendar(&lease, std::time::Duration::from_secs(1))
            .await
            .is_ok(),
        "a lease already released changes nothing"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_queue_depth_counts_claimable_work_waiting(pool: PgPool) {
    let (repo, link, _) = mailbox(&pool).await;
    assert_eq!(
        repo.outlook_queue_depth().await.unwrap(),
        OutlookQueueDepth {
            due_items: 0,
            oldest_due_seconds: None
        }
    );
    let account = two_calendars(&repo).await;
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at=now()-interval '90 seconds' WHERE account_id=$1 AND calendar_id IS NOT NULL",
        account
    )
    .execute(&pool)
    .await
    .unwrap();
    let depth = repo.outlook_queue_depth().await.unwrap();
    assert_eq!(depth.due_items, 2, "both calendars; discovery is not due");
    assert!(depth.oldest_due_seconds.is_some_and(|wait| wait >= 90));

    let leased = claim(&repo).await.unwrap();
    assert!(leased.target.is_some());
    assert_eq!(
        repo.outlook_queue_depth().await.unwrap().due_items,
        1,
        "a leased item is running, not waiting"
    );
    sqlx::query!(
        "UPDATE email_link_microsoft_scopes SET calendar_disabled_at=now() WHERE link_id=$1",
        link
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        repo.outlook_queue_depth().await.unwrap().due_items,
        0,
        "an account no claim may take is not queue depth"
    );
}

/// Discovers one read-only calendar owned by `owner` (the mailbox itself when
/// `None`), finishes its first round, and returns whether discovery marked it
/// a system calendar, how long until its next round, and how long after its
/// sync booking reads it as due.
async fn read_only_calendar_round(pool: &PgPool, owner: Option<&str>) -> (bool, i64, i64) {
    let (repo, _, user) = mailbox(pool).await;
    let discovery = claim(&repo).await.unwrap();
    let mut calendar = discovered_calendar("holidays");
    calendar.calendar.access_role = Some("reader".into());
    calendar.owner_address = Some(owner.map_or_else(
        || discovery.token_identity.email_address.to_uppercase(),
        str::to_owned,
    ));
    repo.commit_outlook_calendars(&discovery, vec![calendar])
        .await
        .unwrap();
    let lease = claim(&repo).await.unwrap();
    let calendar_id = lease.target.as_ref().unwrap().calendar_id;
    clean_round(&repo, &lease).await;
    let row = sqlx::query!(
        r#"SELECT c.system_calendar,c.synced_at AS "synced_at!",
            extract(epoch FROM w.next_run_at-now())::bigint AS "wait!"
        FROM calendars c JOIN calendar_outlook_work w ON w.calendar_id=c.id WHERE c.id=$1"#,
        calendar_id
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let due = repo
        .calendar_sync_health(&user)
        .await
        .unwrap()
        .calendars
        .into_iter()
        .find(|freshness| freshness.calendar_id == calendar_id)
        .unwrap()
        .refresh_due_at
        .unwrap();
    (
        row.system_calendar,
        row.wait,
        (due - row.synced_at).num_seconds(),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_mailboxs_own_read_only_calendar_syncs_once_a_day(pool: PgPool) {
    let (system, wait, due_after) = read_only_calendar_round(&pool, None).await;
    assert!(
        system,
        "a read-only calendar of the mailbox's own, such as its holidays"
    );
    assert!(
        (86_390..=86_400).contains(&wait),
        "its next round is a day away, as Google's system calendars, not {wait} s"
    );
    assert_eq!(
        due_after, 86_400,
        "booking reads it as current for a day after each sync"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_shared_read_only_keeps_its_two_minute_rounds(pool: PgPool) {
    let (system, wait, due_after) = read_only_calendar_round(&pool, Some("ada@example.com")).await;
    assert!(
        !system,
        "a colleague's calendar shared read-only is their schedule"
    );
    assert!((110..=120).contains(&wait), "next round in {wait} s");
    assert_eq!(due_after, 0);
}
