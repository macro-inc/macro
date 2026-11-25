//! Team-sharing certification of Outlook calendars: a full read under the
//! calendar's current role makes a calendar count for teammates, and nothing
//! less does.
use super::*;
use crate::domain::team::TeamCalendarCoverage;

const VIEWER: &str = "macro|outlook-teammate@example.com";

/// What the owner's teammate reads of the owner's calendars.
#[derive(Debug, PartialEq)]
struct TeamView {
    coverage: TeamCalendarCoverage,
    /// UIDs of the events team availability and browsing read.
    sources: Vec<String>,
    /// UIDs on the team out-of-office overlay, with the title it shows.
    out_of_office: Vec<(String, Option<String>)>,
}

/// Puts the owner on a team with `VIEWER`.
async fn teammate(pool: &PgPool, owner: &str) {
    let team = insert_team(pool, VIEWER, &[VIEWER]).await;
    sqlx::query!(
        "INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')",
        owner,
        team
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn team_view(repo: &PgCalendarRepository, owner: &str) -> TeamView {
    let team = PgCalendarTeamRepository::new(repo.pool.clone());
    let coverage = team
        .members(VIEWER, false, &july_2026_range())
        .await
        .unwrap()
        .into_iter()
        .find(|member| member.user_id == owner)
        .unwrap()
        .coverage;
    let mut sources: Vec<_> = team
        .sources(VIEWER, july_2026_range(), &[owner.to_owned()], None, 100)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.event.ical_uid)
        .collect();
    sources.sort();
    sources.dedup();
    let mut out_of_office: Vec<_> = repo
        .list_team_out_of_office(VIEWER, july_2026_range(), 100)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.ical_uid, row.title))
        .collect();
    out_of_office.dedup();
    TeamView {
        coverage,
        sources,
        out_of_office,
    }
}

/// What a teammate reads of a calendar that does not count for them.
fn unavailable() -> TeamView {
    TeamView {
        coverage: TeamCalendarCoverage::Unavailable,
        sources: vec![],
        out_of_office: vec![],
    }
}

/// Outlook's answer to the read of a listed event: an out-of-office for
/// `away`, a meeting for any other UID, under the role the step observed.
fn outlook_event(lease: &OutlookCalendarLease, uid: &str) -> Option<CalendarEventUpsert> {
    let mut event = upsert(lease, uid);
    if uid == "away" {
        event.event.event_type = EventType::OutOfOffice;
        event.event.attendees.clear();
        event.event.recurrence_lines.clear();
    }
    Some(event)
}

/// Runs the claimed round to its end: one page listing `uids`, each event
/// read through `read` (`None` when Macro cannot read it), then the finish.
async fn round(
    repo: &PgCalendarRepository,
    lease: OutlookCalendarLease,
    uids: &[&str],
    read: &dyn Fn(&OutlookCalendarLease, &str) -> Option<CalendarEventUpsert>,
) -> OutlookCheckpoint {
    let members = uids
        .iter()
        .map(|uid| OutlookPageMember {
            provider_id: format!("provider-{uid}"),
            master_id: format!("provider-{uid}"),
            occurs: None,
        })
        .collect();
    repo.checkpoint_outlook_calendar(
        &lease,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members,
            removed: vec![],
            next: None,
            delta: (!lease.near_window).then(|| "terminal".to_owned()),
        }),
    )
    .await
    .unwrap();
    loop {
        let step = claim(repo).await.unwrap();
        assert_eq!(step.id, lease.id);
        let Some(id) = step.pending_ids.first().cloned() else {
            return repo
                .checkpoint_outlook_calendar(&step, OutlookCalendarProgress::Finish)
                .await
                .unwrap();
        };
        let uid = id.strip_prefix("provider-").unwrap();
        let progress = match read(&step, uid) {
            Some(upsert) => {
                repo.upsert_event(CalendarEventWrite::OutlookSync {
                    lease: Box::new(step.clone()),
                    upsert,
                })
                .await
                .unwrap();
                OutlookCalendarProgress::Event { id, exists: true }
            }
            None => OutlookCalendarProgress::Unreadable { id },
        };
        repo.checkpoint_outlook_calendar(&step, progress)
            .await
            .unwrap();
    }
}

/// Discovers the mailbox's primary calendar and imports `uids` into it: this
/// month and next, then the whole window. Returns the whole window's lease.
async fn first_import(
    repo: &PgCalendarRepository,
    uids: &[&str],
    read: &dyn Fn(&OutlookCalendarLease, &str) -> Option<CalendarEventUpsert>,
) -> OutlookCalendarLease {
    let near = calendar(repo).await;
    assert_eq!(
        round(repo, near, uids, read).await,
        OutlookCheckpoint::NearWindowImported
    );
    let whole = claim(repo).await.unwrap();
    assert_eq!(
        round(repo, whole.clone(), uids, read).await,
        OutlookCheckpoint::RoundFinished {
            first_sync: true,
            cleared_sync_error: false
        }
    );
    whole
}

/// Runs the account's discovery now, finding `calendars`.
async fn discover(repo: &PgCalendarRepository, calendars: Vec<OutlookCalendar>) {
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at = now() - interval '1 day' WHERE calendar_id IS NULL"
    )
    .execute(&repo.pool)
    .await
    .unwrap();
    let lease = claim(repo).await.unwrap();
    assert!(lease.target.is_none());
    repo.commit_outlook_calendars(&lease, calendars)
        .await
        .unwrap();
}

/// The calendar as Outlook lists it once the mailbox can only read it.
fn read_only_primary() -> OutlookCalendar {
    let mut primary = discovered_calendar("primary");
    primary.calendar.access_role = Some("reader".into());
    primary
}

/// Claims the calendar's next round now.
async fn next_round(repo: &PgCalendarRepository, work_id: Uuid) -> OutlookCalendarLease {
    sqlx::query!(
        "UPDATE calendar_outlook_work SET next_run_at = now() WHERE id = $1",
        work_id
    )
    .execute(&repo.pool)
    .await
    .unwrap();
    let lease = claim(repo).await.unwrap();
    assert_eq!(lease.id, work_id);
    lease
}

/// The calendar's scan: its identity, which only a reset replaces, and
/// whether it reads every event.
async fn scan(repo: &PgCalendarRepository, work_id: Uuid) -> (Uuid, bool) {
    let work = sqlx::query!(
        "SELECT scan_id, full_scan FROM calendar_outlook_work WHERE id = $1",
        work_id
    )
    .fetch_one(&repo.pool)
    .await
    .unwrap();
    (work.scan_id, work.full_scan)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_full_outlook_read_shows_teammates_its_busy_time_and_time_off(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let near = calendar(&repo).await;
    assert_eq!(
        round(&repo, near, &["away", "meeting"], &outlook_event).await,
        OutlookCheckpoint::NearWindowImported
    );
    assert_eq!(
        team_view(&repo, &owner).await,
        unavailable(),
        "a calendar mid-import counts for no teammate"
    );

    let whole = claim(&repo).await.unwrap();
    round(&repo, whole, &["away", "meeting"], &outlook_event).await;

    assert_eq!(
        team_view(&repo, &owner).await,
        TeamView {
            coverage: TeamCalendarCoverage::Ready,
            sources: vec!["away".into(), "meeting".into()],
            out_of_office: vec![("away".into(), None)],
        },
        "busy-only sharing shows the time off without its title"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_role_change_withdraws_the_calendar_until_every_event_is_read_again(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let whole = first_import(&repo, &["meeting"], &outlook_event).await;
    assert_eq!(
        team_view(&repo, &owner).await.coverage,
        TeamCalendarCoverage::Ready
    );

    // A delta round lists the meeting, and before it is read the mailbox
    // loses edit access to the calendar.
    let delta = next_round(&repo, whole.id).await;
    repo.checkpoint_outlook_calendar(
        &delta,
        OutlookCalendarProgress::Page(OutlookCalendarPage {
            members: untimed(&[("provider-meeting", "provider-meeting")]),
            removed: vec![],
            next: None,
            delta: Some("terminal".into()),
        }),
    )
    .await
    .unwrap();
    let (scan_before, _) = scan(&repo, whole.id).await;
    discover(&repo, vec![read_only_primary()]).await;

    assert_eq!(team_view(&repo, &owner).await, unavailable());
    let (scan_after, full_scan) = scan(&repo, whole.id).await;
    assert_ne!(scan_after, scan_before, "the round in progress starts over");
    assert!(full_scan, "and reads every event under the new role");

    let near = claim(&repo).await.unwrap();
    assert!(near.near_window, "the calendar is imported anew");
    round(&repo, near, &["meeting"], &outlook_event).await;
    let whole = claim(&repo).await.unwrap();
    round(&repo, whole, &["meeting"], &outlook_event).await;
    assert_eq!(
        team_view(&repo, &owner).await,
        TeamView {
            coverage: TeamCalendarCoverage::Ready,
            sources: vec!["meeting".into()],
            out_of_office: vec![],
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_copy_written_under_a_stale_role_stays_out_until_a_scan_reads_it_again(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let whole = first_import(&repo, &["meeting"], &outlook_event).await;

    // An edit's echo carries the role observed before its request, which the
    // calendar has lost since.
    let edited = |lease: &OutlookCalendarLease, uid: &str| {
        let mut event = upsert(lease, uid);
        event.event.title = "Moved meeting".into();
        event.event.sequence = 1;
        event.event.updated_at += Duration::hours(1);
        Some(event)
    };
    let mut echo = edited(&whole, "meeting").unwrap();
    echo.source.details_mut().observed_access_role = Some("reader".into());
    repo.upsert_event(CalendarEventWrite::UserMutation(echo))
        .await
        .unwrap();
    assert_eq!(team_view(&repo, &owner).await, unavailable());

    let (scan_before, _) = scan(&repo, whole.id).await;
    discover(&repo, vec![discovered_calendar("primary")]).await;
    let (scan_after, full_scan) = scan(&repo, whole.id).await;
    assert_ne!(scan_after, scan_before);
    assert!(
        full_scan,
        "the primary calendar's next round reads every event"
    );

    let full = next_round(&repo, whole.id).await;
    assert!(!full.near_window, "its coverage stays");
    round(&repo, full, &["meeting"], &edited).await;
    assert_eq!(
        team_view(&repo, &owner).await,
        TeamView {
            coverage: TeamCalendarCoverage::Ready,
            sources: vec!["meeting".into()],
            out_of_office: vec![],
        },
        "an unchanged read verifies the copy under the calendar's role"
    );
    let verified = scan(&repo, whole.id).await;
    discover(&repo, vec![discovered_calendar("primary")]).await;
    assert_eq!(
        scan(&repo, whole.id).await,
        verified,
        "a verified calendar is not read again"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_event_macro_cannot_read_keeps_the_calendar_uncertified_without_rescans(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let unreadable =
        |lease: &OutlookCalendarLease, uid: &str| (uid != "lost").then(|| upsert(lease, uid));
    let whole = first_import(&repo, &["lost", "meeting"], &unreadable).await;

    assert_eq!(
        team_view(&repo, &owner).await,
        unavailable(),
        "teammates would read the event Macro could not read as free time"
    );
    let before = scan(&repo, whole.id).await;
    discover(&repo, vec![discovered_calendar("primary")]).await;
    assert_eq!(
        scan(&repo, whole.id).await,
        before,
        "a full scan would skip it again, so discovery starts none"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_synced_before_certification_gets_one_full_scan(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let whole = first_import(&repo, &["meeting"], &outlook_event).await;
    // Every Outlook calendar synced before Outlook certified its snapshots.
    sqlx::query!("UPDATE calendars SET snapshot_normalization_version = 0")
        .execute(&pool)
        .await
        .unwrap();

    let delta = next_round(&repo, whole.id).await;
    round(&repo, delta, &[], &outlook_event).await;
    assert_eq!(
        team_view(&repo, &owner).await,
        unavailable(),
        "a delta round cannot vouch for the events it did not list"
    );

    discover(&repo, vec![discovered_calendar("primary")]).await;
    let (_, full_scan) = scan(&repo, whole.id).await;
    assert!(full_scan);
    let full = next_round(&repo, whole.id).await;
    round(&repo, full, &["meeting"], &outlook_event).await;
    assert_eq!(
        team_view(&repo, &owner).await.coverage,
        TeamCalendarCoverage::Ready
    );

    let delta = next_round(&repo, whole.id).await;
    round(&repo, delta, &[], &outlook_event).await;
    let verified = scan(&repo, whole.id).await;
    discover(&repo, vec![discovered_calendar("primary")]).await;
    assert_eq!(
        scan(&repo, whole.id).await,
        (verified.0, false),
        "the certified calendar keeps its delta rounds"
    );
    assert_eq!(
        team_view(&repo, &owner).await.coverage,
        TeamCalendarCoverage::Ready
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_calendar_listed_again_after_its_removal_is_imported_anew(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let whole = first_import(&repo, &["meeting"], &outlook_event).await;
    let calendar_id = whole.target.as_ref().unwrap().calendar_id;

    discover(&repo, vec![discovered_calendar("shared")]).await;
    discover(
        &repo,
        vec![
            discovered_calendar("primary"),
            discovered_calendar("shared"),
        ],
    )
    .await;

    let calendar = sqlx::query!(
        r#"SELECT is_deleted, synced_at, materialized_starts_at, snapshot_normalization_version
        FROM calendars WHERE id = $1"#,
        calendar_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!calendar.is_deleted);
    assert_eq!(
        (
            calendar.synced_at,
            calendar.materialized_starts_at,
            calendar.snapshot_normalization_version
        ),
        (None, None, 0),
        "its retired events took its coverage and certificate with them"
    );
    let (_, full_scan) = scan(&repo, whole.id).await;
    assert!(full_scan);
    assert_eq!(team_view(&repo, &owner).await, unavailable());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_series_read_again_without_an_occurrence_loses_the_role_an_older_build_stored(
    pool: PgPool,
) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    // Builds before certification skipped the occurrence too, but stored the
    // series under the calendar's role.
    let whole = first_import(&repo, &["series"], &outlook_event).await;
    assert_eq!(
        team_view(&repo, &owner).await.coverage,
        TeamCalendarCoverage::Ready
    );

    let missing_an_occurrence = |lease: &OutlookCalendarLease, uid: &str| {
        let mut event = upsert(lease, uid);
        event.source.details_mut().observed_access_role = None;
        Some(event)
    };
    let delta = next_round(&repo, whole.id).await;
    round(&repo, delta, &["series"], &missing_an_occurrence).await;

    assert_eq!(
        team_view(&repo, &owner).await,
        unavailable(),
        "the unchanged copy is no longer the calendar's whole series"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stale_role_a_delta_round_passes_still_gets_its_full_scan(pool: PgPool) {
    let (repo, _, owner) = mailbox(&pool).await;
    teammate(&pool, &owner).await;
    let whole = first_import(&repo, &["meeting"], &outlook_event).await;
    let edited = |lease: &OutlookCalendarLease, uid: &str| {
        let mut event = upsert(lease, uid);
        event.event.title = "Moved meeting".into();
        event.event.sequence = 1;
        event.event.updated_at += Duration::hours(1);
        Some(event)
    };
    let mut echo = edited(&whole, "meeting").unwrap();
    echo.source.details_mut().observed_access_role = Some("reader".into());
    repo.upsert_event(CalendarEventWrite::UserMutation(echo))
        .await
        .unwrap();

    // A delta round with nothing to list finishes before discovery runs, and
    // moves the calendar's sync time past the echo.
    let delta = next_round(&repo, whole.id).await;
    round(&repo, delta, &[], &outlook_event).await;
    assert_eq!(team_view(&repo, &owner).await, unavailable());
    assert!(
        scan(&repo, whole.id).await.1,
        "the round that hid the echo schedules its full scan"
    );

    let full = next_round(&repo, whole.id).await;
    assert!(!full.near_window, "its coverage stays");
    round(&repo, full, &["meeting"], &edited).await;
    assert_eq!(
        team_view(&repo, &owner).await,
        TeamView {
            coverage: TeamCalendarCoverage::Ready,
            sources: vec!["meeting".into()],
            out_of_office: vec![],
        }
    );
    assert!(
        !scan(&repo, whole.id).await.1,
        "the verified calendar goes back to delta rounds"
    );
}
