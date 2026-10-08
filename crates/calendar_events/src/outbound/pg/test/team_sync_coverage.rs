use super::*;
use crate::domain::team::{CalendarTeamRepository, TeamCalendarCoverage};
use crate::outbound::pg_team::PgCalendarTeamRepository;

struct SyncFixture {
    repo: PgCalendarRepository,
    team: PgCalendarTeamRepository,
    owner: String,
    viewer: String,
    account: Uuid,
    calendar: Uuid,
    secondary: Uuid,
    key: CalendarBackfillJobKey,
    events: Vec<CalendarEventUpsert>,
}

fn provider_calendar(id: &str, zone: &str) -> ProviderCalendar {
    ProviderCalendar {
        provider_calendar_id: id.to_owned(),
        name: id.to_owned(),
        description: None,
        time_zone: Some(zone.to_owned()),
        color: None,
        access_role: Some("owner".to_owned()),
        is_primary: id == "primary",
        is_selected: true,
        default_reminders: Vec::new(),
    }
}

fn shift_event(event: &mut CalendarEventUpsert, hours: i64) {
    let shift = |time: &mut EventTime| {
        let EventTime::Timed {
            starts_at, ends_at, ..
        } = time
        else {
            panic!("timed fixture");
        };
        *starts_at += Duration::hours(hours);
        *ends_at += Duration::hours(hours);
    };
    shift(&mut event.event.time);
    for occurrence in &mut event.occurrences {
        shift(&mut occurrence.time);
    }
}

impl SyncFixture {
    async fn new(pool: PgPool, label: &str) -> Self {
        let owner = format!("macro|{label}-owner@example.com");
        let viewer = format!("macro|{label}-viewer@example.com");
        insert_team(&pool, &viewer, &[&viewer, &owner]).await;
        let link = insert_link(&pool, &owner).await;
        let repo = PgCalendarRepository::new(pool.clone());
        let grant = repo
            .apply_google_grant(
                link,
                complete_grant(),
                CalendarGrantIntent::CalendarRequested,
            )
            .await
            .unwrap();
        let job = grant
            .jobs
            .into_iter()
            .find(|job| job.kind == CalendarBackfillKind::GoogleCalendar)
            .unwrap();
        let account = job.account_id.unwrap();
        let key = CalendarBackfillJobKey {
            job_id: job.id,
            email_link_id: link,
        };
        let CalendarBackfillClaim::Claimed { lease_token, .. } =
            repo.claim_google_backfill(key).await.unwrap()
        else {
            panic!("initial sync is claimable");
        };
        let calendar = repo
            .upsert_google_calendar(
                key,
                lease_token,
                account,
                provider_calendar("primary", "UTC"),
            )
            .await
            .unwrap()
            .id;
        let secondary = repo
            .upsert_google_calendar(
                key,
                lease_token,
                account,
                provider_calendar("secondary", "UTC"),
            )
            .await
            .unwrap()
            .id;
        let mut events = vec![];
        for (uid, hours) in [("a", -5), ("b", -4)] {
            let mut event = timed_upsert(&owner, link, (account, calendar), uid, uid, 1);
            event.occurrences.truncate(1);
            shift_event(&mut event, hours);
            repo.upsert_event(CalendarEventWrite::GoogleBackfill {
                key,
                lease_token,
                upsert: event.clone(),
            })
            .await
            .unwrap();
            events.push(event);
        }
        for id in [calendar, secondary] {
            repo.commit_google_calendar_sync(
                key,
                lease_token,
                account,
                GoogleCalendarSyncSnapshot {
                    calendar_id: id,
                    next_sync_token: "initial".to_owned(),
                    materialized_range: Some(july_2026_range()),
                    observed_provider_event_ids: Some(if id == calendar {
                        vec!["provider-a".to_owned(), "provider-b".to_owned()]
                    } else {
                        vec![]
                    }),
                    cancelled_provider_event_ids: vec![],
                },
                0,
            )
            .await
            .unwrap();
        }
        repo.complete_google_backfill(key, lease_token)
            .await
            .unwrap();
        Self {
            repo,
            team: PgCalendarTeamRepository::new(pool),
            owner,
            viewer,
            account,
            calendar,
            secondary,
            key,
            events,
        }
    }

    async fn begin_poll(&self) -> Uuid {
        assert!(
            self.repo
                .schedule_google_sync_for_link(self.key.email_link_id)
                .await
                .unwrap()
        );
        let CalendarBackfillClaim::Claimed { lease_token, .. } =
            self.repo.claim_google_backfill(self.key).await.unwrap()
        else {
            panic!("incremental sync is claimable");
        };
        self.repo
            .mark_google_account_syncing(self.key, lease_token)
            .await
            .unwrap();
        lease_token
    }

    async fn assert_coverage(&self, ready: bool, sources: usize) {
        assert_eq!(
            self.team
                .members(&self.viewer, false, &july_2026_range())
                .await
                .unwrap()[0]
                .coverage,
            if ready {
                TeamCalendarCoverage::Ready
            } else {
                TeamCalendarCoverage::Unavailable
            }
        );
        assert_eq!(
            self.team
                .sources(
                    &self.viewer,
                    july_2026_range(),
                    std::slice::from_ref(&self.owner),
                    None,
                    100
                )
                .await
                .unwrap()
                .len(),
            sources
        );
    }

    fn token_only(&self) -> GoogleCalendarSyncSnapshot {
        GoogleCalendarSyncSnapshot {
            calendar_id: self.calendar,
            next_sync_token: "next".to_owned(),
            materialized_range: None,
            observed_provider_event_ids: None,
            cancelled_provider_event_ids: vec![],
        }
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_coverage_quiet_poll_stays_ready_but_partial_event_swap_withdraws_it(pool: PgPool) {
    let fixture = SyncFixture::new(pool, "swap").await;
    fixture.assert_coverage(true, 2).await;
    let revision = fixture
        .team
        .projection_revision(&fixture.viewer)
        .await
        .unwrap();
    let lease = fixture.begin_poll().await;
    fixture
        .repo
        .upsert_google_calendar(
            fixture.key,
            lease,
            fixture.account,
            provider_calendar("primary", "UTC"),
        )
        .await
        .unwrap();
    for event in &fixture.events {
        fixture
            .repo
            .upsert_event(CalendarEventWrite::GoogleBackfill {
                key: fixture.key,
                lease_token: lease,
                upsert: event.clone(),
            })
            .await
            .unwrap();
    }
    // A stale response rejected by the source freshness predicate is also a no-op.
    let mut stale = fixture.events[0].clone();
    stale.event.sequence = 0;
    stale.event.updated_at -= Duration::minutes(1);
    stale.event.title = "stale".to_owned();
    fixture
        .repo
        .upsert_event(CalendarEventWrite::GoogleBackfill {
            key: fixture.key,
            lease_token: lease,
            upsert: stale,
        })
        .await
        .unwrap();
    fixture
        .repo
        .commit_google_calendar_sync(fixture.key, lease, fixture.account, fixture.token_only(), 0)
        .await
        .unwrap();
    fixture.assert_coverage(true, 2).await;
    assert_eq!(
        revision,
        fixture
            .team
            .projection_revision(&fixture.viewer)
            .await
            .unwrap()
    );
    fixture
        .repo
        .complete_google_backfill(fixture.key, lease)
        .await
        .unwrap();
    assert_eq!(
        revision,
        fixture
            .team
            .projection_revision(&fixture.viewer)
            .await
            .unwrap()
    );

    let lease = fixture.begin_poll().await;
    // Swapping A09/B10 to A10/B09 must never expose the intermediate free 09 slot.
    for (event, hours) in fixture.events.iter().zip([1, -1]) {
        let mut moved = event.clone();
        moved.event.sequence += 1;
        moved.event.updated_at += Duration::minutes(1);
        shift_event(&mut moved, hours);
        fixture
            .repo
            .upsert_event(CalendarEventWrite::GoogleBackfill {
                key: fixture.key,
                lease_token: lease,
                upsert: moved,
            })
            .await
            .unwrap();
        fixture.assert_coverage(false, 0).await;
        assert_ne!(
            revision,
            fixture
                .team
                .projection_revision(&fixture.viewer)
                .await
                .unwrap()
        );
    }
    fixture
        .repo
        .commit_google_calendar_sync(fixture.key, lease, fixture.account, fixture.token_only(), 2)
        .await
        .unwrap();
    fixture.assert_coverage(false, 0).await;
    fixture
        .repo
        .complete_google_backfill(fixture.key, lease)
        .await
        .unwrap();
    fixture.assert_coverage(true, 2).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn team_coverage_withdraws_on_source_removal_calendar_removal_and_timezone_change(
    pool: PgPool,
) {
    for case in ["cancel", "snapshot", "timezone", "calendar-list"] {
        let fixture = SyncFixture::new(pool.clone(), case).await;
        let lease = fixture.begin_poll().await;
        match case {
            "cancel" | "snapshot" => {
                let mut snapshot = fixture.token_only();
                if case == "cancel" {
                    snapshot.cancelled_provider_event_ids = vec!["provider-a".to_owned()];
                } else {
                    snapshot.observed_provider_event_ids = Some(vec!["provider-b".to_owned()]);
                    snapshot.materialized_range = Some(july_2026_range());
                }
                fixture
                    .repo
                    .commit_google_calendar_sync(fixture.key, lease, fixture.account, snapshot, 0)
                    .await
                    .unwrap();
            }
            "timezone" => {
                fixture
                    .repo
                    .upsert_google_calendar(
                        fixture.key,
                        lease,
                        fixture.account,
                        provider_calendar("primary", "America/New_York"),
                    )
                    .await
                    .unwrap();
            }
            "calendar-list" => {
                assert_ne!(fixture.calendar, fixture.secondary);
                fixture
                    .repo
                    .reconcile_google_calendar_list(
                        fixture.key,
                        lease,
                        fixture.account,
                        vec![fixture.calendar],
                    )
                    .await
                    .unwrap();
            }
            _ => unreachable!(),
        }
        fixture.assert_coverage(false, 0).await;
        fixture
            .repo
            .complete_google_backfill(fixture.key, lease)
            .await
            .unwrap();
        fixture
            .assert_coverage(
                true,
                if matches!(case, "cancel" | "snapshot") {
                    1
                } else {
                    2
                },
            )
            .await;
    }
}
