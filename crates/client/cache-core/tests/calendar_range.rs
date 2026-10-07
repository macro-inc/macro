use cache_core::calendar::{
    CalendarCommit, CalendarFreshness, CalendarLinkWatermark, CalendarRangeRequest,
    CalendarReplacedEvent, CalendarSpan, CalendarSpanKind, CalendarWatermarkUpdate,
};
use cache_core::engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome};
use cache_core::identity::IdentityBinding;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
// 2026-10-05T00:00:00Z
const MONDAY_MS: i64 = 1_791_158_400_000;
const MONDAY_DAY: i64 = 20_731;

const MUTATION: &str = "mutation Save { setEntityProperty { __typename id displayName } }";
const UUID: &str = "22222222-2222-4222-8222-222222222222";

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn text(value: &str) -> CacheValue {
    CacheValue::String(value.into())
}

fn iso(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .unwrap()
        .to_rfc3339()
}

fn date(day: i64) -> String {
    (chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap() + chrono::Duration::days(day)).to_string()
}

fn time_object(fields: Vec<(&str, String)>) -> CacheValue {
    CacheValue::Object(
        fields
            .into_iter()
            .map(|(field, value)| (field.to_owned(), CacheValue::String(value)))
            .collect::<BTreeMap<_, _>>(),
    )
}

fn occurrence(event: &str, link: &str, time: CacheValue) -> Record {
    let mut record = Record::default();
    for (field, value) in [
        ("__typename", text("GraphqlCalendarOccurrence")),
        ("eventId", text(event)),
        ("linkId", text(link)),
        ("isCancelled", CacheValue::Bool(false)),
        ("time", time),
    ] {
        record.fields.insert(field.into(), value);
    }
    record
}

fn timed(event: &str, link: &str, start_ms: i64, end_ms: i64) -> (EntityKey<'static>, Record) {
    let start = iso(start_ms);
    (
        key(&format!("GraphqlCalendarOccurrence:{event}:{start}")),
        occurrence(
            event,
            link,
            time_object(vec![
                ("__typename", "GraphqlTimedEventTime".into()),
                ("startsAt", start),
                ("endsAt", iso(end_ms)),
            ]),
        ),
    )
}

fn all_day(event: &str, link: &str, start_day: i64, end_day: i64) -> (EntityKey<'static>, Record) {
    (
        key(&format!(
            "GraphqlCalendarOccurrence:{event}:{}",
            date(start_day)
        )),
        occurrence(
            event,
            link,
            time_object(vec![
                ("__typename", "GraphqlAllDayEventTime".into()),
                ("startDate", date(start_day)),
                ("endDate", date(end_day)),
            ]),
        ),
    )
}

fn linked(typename: &str, id: &str, link: &str) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    record.fields.insert("__typename".into(), text(typename));
    record.fields.insert("id".into(), text(id));
    record.fields.insert("linkId".into(), text(link));
    (EntityKey::entity(typename, &[id]), record)
}

fn week() -> CalendarRangeRequest {
    CalendarRangeRequest {
        start_ms: MONDAY_MS,
        end_ms: MONDAY_MS + 7 * DAY_MS,
        start_day: MONDAY_DAY,
        end_day: MONDAY_DAY + 7,
        event_key: None,
    }
}

fn week_coverage() -> Vec<CalendarSpan> {
    vec![
        CalendarSpan {
            kind: CalendarSpanKind::Timed,
            start: MONDAY_MS,
            end: MONDAY_MS + 7 * DAY_MS,
        },
        CalendarSpan {
            kind: CalendarSpanKind::AllDay,
            start: MONDAY_DAY,
            end: MONDAY_DAY + 7,
        },
    ]
}

fn link(link_id: &str, seq: i64) -> CalendarLinkWatermark {
    CalendarLinkWatermark {
        link_id: link_id.into(),
        seq,
    }
}

async fn seeded(entries: Vec<(EntityKey<'static>, Record)>) -> Engine<InMemoryStorage> {
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .put_records_with_projections(None, entries, Vec::new())
        .await
        .unwrap();
    engine
}

#[test]
fn ranges_return_overlapping_occurrences_of_both_kinds() {
    block_on(async {
        let inside = timed(
            "e1",
            "l1",
            MONDAY_MS + 9 * HOUR_MS,
            MONDAY_MS + 10 * HOUR_MS,
        );
        let ends_at_start = timed("e2", "l1", MONDAY_MS - HOUR_MS, MONDAY_MS);
        let starts_at_end = timed("e3", "l1", MONDAY_MS + 7 * DAY_MS, MONDAY_MS + 8 * DAY_MS);
        let long = timed("e4", "l1", MONDAY_MS - 30 * DAY_MS, MONDAY_MS + HOUR_MS);
        let holiday = all_day("e5", "l1", MONDAY_DAY + 6, MONDAY_DAY + 7);
        let next_week = all_day("e6", "l1", MONDAY_DAY + 7, MONDAY_DAY + 8);
        let mut engine = seeded(vec![
            inside.clone(),
            ends_at_start,
            starts_at_end,
            long.clone(),
            holiday.clone(),
            next_week,
        ])
        .await;

        let result = engine.calendar_range(&week()).await.unwrap();
        assert_eq!(
            result.occurrence_keys,
            [long.0.clone(), inside.0.clone(), holiday.0.clone()]
        );
        assert_eq!(result.gaps, week_coverage());
        assert_eq!(result.freshness, CalendarFreshness::Unknown);
        assert_eq!(result.watermark, None);
        assert!(!result.optimistic);

        let mut only_e1 = week();
        only_e1.event_key = Some(key("GraphqlCalendarEvent:e1"));
        assert_eq!(
            engine
                .calendar_range(&only_e1)
                .await
                .unwrap()
                .occurrence_keys,
            [inside.0]
        );
    });
}

#[test]
fn coverage_and_watermarks_persist_across_commits() {
    block_on(async {
        let mut engine = seeded(Vec::new()).await;
        let first = engine
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 10), link("l2", 4)],
                }),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        assert!(first.revision_advanced);
        let result = engine.calendar_range(&week()).await.unwrap();
        assert!(result.gaps.is_empty());
        assert_eq!(result.watermark, Some(vec![link("l1", 10), link("l2", 4)]));

        let mut two_weeks = week();
        two_weeks.end_ms += 7 * DAY_MS;
        two_weeks.end_day += 7;
        assert_eq!(
            engine.calendar_range(&two_weeks).await.unwrap().gaps,
            [
                CalendarSpan {
                    kind: CalendarSpanKind::Timed,
                    start: MONDAY_MS + 7 * DAY_MS,
                    end: MONDAY_MS + 14 * DAY_MS,
                },
                CalendarSpan {
                    kind: CalendarSpanKind::AllDay,
                    start: MONDAY_DAY + 7,
                    end: MONDAY_DAY + 14,
                },
            ]
        );

        // A page captured before an older replica read lowers the watermark.
        engine
            .calendar_commit(&CalendarCommit {
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 7)],
                }),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        engine
            .calendar_commit(&CalendarCommit {
                watermark: Some(CalendarWatermarkUpdate::Advance {
                    since: vec![link("l1", 7), link("l2", 4)],
                    to: vec![link("l1", 12), link("l2", 6)],
                }),
                freshness: Some(CalendarFreshness::Fresh),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let result = engine.calendar_range(&week()).await.unwrap();
        assert_eq!(result.watermark, Some(vec![link("l1", 12), link("l2", 6)]));
        assert_eq!(result.freshness, CalendarFreshness::Fresh);
    });
}

#[test]
fn commits_replace_occurrence_sets_and_delete_by_event_and_link() {
    block_on(async {
        let kept = timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let moved_away = timed("e1", "l1", MONDAY_MS + DAY_MS, MONDAY_MS + DAY_MS + HOUR_MS);
        let deleted_event = timed("e2", "l1", MONDAY_MS + 3 * HOUR_MS, MONDAY_MS + 4 * HOUR_MS);
        let other_link = timed("e3", "l2", MONDAY_MS + 5 * HOUR_MS, MONDAY_MS + 6 * HOUR_MS);
        let event_e2 = linked("GraphqlCalendarEvent", "e2", "l1");
        let event_e3 = linked("GraphqlCalendarEvent", "e3", "l2");
        let calendar_l1 = linked("GraphqlCalendar", "c1", "l1");
        let calendar_l2 = linked("GraphqlCalendar", "c2", "l2");
        let mut engine = seeded(vec![
            kept.clone(),
            moved_away.clone(),
            deleted_event.clone(),
            other_link.clone(),
            event_e2.clone(),
            event_e3.clone(),
            calendar_l1.clone(),
            calendar_l2.clone(),
        ])
        .await;

        let result = engine
            .calendar_commit(&CalendarCommit {
                replaced_events: vec![CalendarReplacedEvent {
                    event_key: key("GraphqlCalendarEvent:e1"),
                    occurrence_keys: vec![kept.0.clone()],
                }],
                deleted_event_keys: vec![event_e2.0.clone()],
                deleted_calendar_keys: vec![calendar_l1.0.clone()],
                removed_link_ids: vec!["l2".into()],
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        assert_eq!(
            result.changed.into_iter().collect::<Vec<_>>(),
            [
                calendar_l1.0.clone(),
                calendar_l2.0.clone(),
                event_e2.0.clone(),
                event_e3.0.clone(),
                deleted_event.0.clone(),
                moved_away.0.clone(),
                other_link.0.clone(),
            ]
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
        );
        assert_eq!(
            engine
                .calendar_range(&week())
                .await
                .unwrap()
                .occurrence_keys,
            std::slice::from_ref(&kept.0)
        );
        let stored = engine
            .storage()
            .get_batch(&[
                moved_away.0,
                event_e2.0,
                event_e3.0,
                calendar_l1.0,
                calendar_l2.0,
                kept.0,
            ])
            .await
            .unwrap();
        assert_eq!(
            stored.iter().map(Option::is_some).collect::<Vec<_>>(),
            [false, false, false, false, false, true]
        );
    });
}

#[test]
fn reset_drops_calendar_records_coverage_and_sync_state() {
    block_on(async {
        let occurrence = timed("e1", "l1", MONDAY_MS, MONDAY_MS + HOUR_MS);
        let event = linked("GraphqlCalendarEvent", "e1", "l1");
        let calendar = linked("GraphqlCalendar", "c1", "l1");
        let mut engine = seeded(vec![occurrence.clone(), event.clone(), calendar.clone()]).await;
        engine
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 3), link("l2", 8)],
                }),
                freshness: Some(CalendarFreshness::Fresh),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();

        engine
            .calendar_commit(&CalendarCommit {
                reset: true,
                watermark: Some(CalendarWatermarkUpdate::Advance {
                    since: vec![link("l1", 3), link("l2", 8)],
                    to: vec![link("l1", 40)],
                }),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let result = engine.calendar_range(&week()).await.unwrap();
        assert!(result.occurrence_keys.is_empty());
        assert_eq!(result.gaps, week_coverage());
        assert_eq!(result.watermark, Some(vec![link("l1", 40)]));
        assert_eq!(result.freshness, CalendarFreshness::Unknown);
        let stored = engine
            .storage()
            .get_batch(&[occurrence.0, event.0, calendar.0])
            .await
            .unwrap();
        assert_eq!(
            stored.iter().map(Option::is_some).collect::<Vec<_>>(),
            [false, false, true]
        );
    });
}

#[test]
fn records_rewritten_out_of_range_or_cancelled_leave_the_index() {
    block_on(async {
        let (occurrence_key, mut record) =
            timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let mut engine = seeded(vec![(occurrence_key.clone(), record.clone())]).await;
        record
            .fields
            .insert("isCancelled".into(), CacheValue::Bool(true));
        engine
            .put_records_with_projections(None, vec![(occurrence_key.clone(), record)], Vec::new())
            .await
            .unwrap();
        assert!(
            engine
                .calendar_range(&week())
                .await
                .unwrap()
                .occurrence_keys
                .is_empty()
        );
        engine
            .delete_keys(std::slice::from_ref(&occurrence_key))
            .await
            .unwrap();
        assert!(
            engine
                .calendar_range(&week())
                .await
                .unwrap()
                .occurrence_keys
                .is_empty()
        );
    });
}

async fn enqueue_delete(
    engine: &mut Engine<InMemoryStorage>,
    occurrence_key: &EntityKey<'static>,
    uncertain: Vec<EntityKey<'static>>,
) -> (u64, MutationClaimToken) {
    let result = engine
        .enqueue_optimistic_mutation_with_calendar(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: UUID,
                query: MUTATION,
                operation_name: None,
                variables: &Default::default(),
                data: &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "p1", "displayName": "x"}}),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: &[IdentityBinding {
                    local_key: occurrence_key.clone(),
                    delete_record: true,
                    response_path: vec![],
                    reference_fields: vec![],
                    revalidation_variables: vec![],
                }],
            },
            MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 0,
                lease_expires_at_ms: 100,
            },
            Vec::new(),
            uncertain,
        )
        .await
        .unwrap();
    let InitialClaimOutcome::Claimed(claimed) = result.initial_claim else {
        panic!("the only queued mutation is claimable");
    };
    (
        result.transaction_id,
        MutationClaimToken {
            owner: "runner".into(),
            generation: claimed.lease_generation,
        },
    )
}

#[test]
fn optimistic_deletes_and_uncertain_events_shape_reads_until_rollback() {
    block_on(async {
        let deleted = timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let kept = timed("e2", "l1", MONDAY_MS + 3 * HOUR_MS, MONDAY_MS + 4 * HOUR_MS);
        let mut engine = seeded(vec![deleted.clone(), kept.clone()]).await;
        let (transaction, claim) = enqueue_delete(
            &mut engine,
            &deleted.0,
            vec![key("GraphqlCalendarEvent:e2")],
        )
        .await;

        let result = engine.calendar_range(&week()).await.unwrap();
        assert_eq!(result.occurrence_keys, std::slice::from_ref(&kept.0));
        assert!(result.optimistic);
        assert_eq!(
            result.uncertain_event_keys,
            [key("GraphqlCalendarEvent:e2")]
        );
        let mut only_e1 = week();
        only_e1.event_key = Some(key("GraphqlCalendarEvent:e1"));
        assert!(
            engine
                .calendar_range(&only_e1)
                .await
                .unwrap()
                .uncertain_event_keys
                .is_empty()
        );

        // The layer survives an engine restart over the same storage.
        let mut engine = Engine::new(engine.into_storage());
        assert_eq!(
            engine
                .calendar_range(&week())
                .await
                .unwrap()
                .occurrence_keys,
            std::slice::from_ref(&kept.0)
        );

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        let result = engine.calendar_range(&week()).await.unwrap();
        assert_eq!(result.occurrence_keys, [deleted.0, kept.0]);
        assert!(!result.optimistic);
        assert!(result.uncertain_event_keys.is_empty());
    });
}

#[test]
fn committed_optimistic_deletes_retire_the_authoritative_row() {
    block_on(async {
        let deleted = timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let mut engine = seeded(vec![deleted.clone()]).await;
        let (transaction, claim) = enqueue_delete(&mut engine, &deleted.0, Vec::new()).await;
        engine
            .commit_optimistic_write(
                transaction,
                claim,
                MUTATION,
                None,
                &Default::default(),
                &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "p1", "displayName": "x"}}),
            )
            .await
            .unwrap();
        let result = engine.calendar_range(&week()).await.unwrap();
        assert!(result.occurrence_keys.is_empty());
        assert!(!result.optimistic);
    });
}

#[test]
fn uncertain_keys_must_name_calendar_events() {
    block_on(async {
        let occurrence = timed("e1", "l1", MONDAY_MS, MONDAY_MS + HOUR_MS);
        let mut engine = seeded(vec![occurrence.clone()]).await;
        let error = engine
            .enqueue_optimistic_mutation_with_calendar(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    uuid: UUID,
                    query: MUTATION,
                    operation_name: None,
                    variables: &Default::default(),
                    data: &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "p1", "displayName": "x"}}),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                    identity_bindings: &[],
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 0,
                    lease_expires_at_ms: 100,
                },
                Vec::new(),
                vec![occurrence.0],
            )
            .await;
        assert!(error.is_err());
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
    });
}

#[test]
fn identity_changes_and_clears_wipe_calendar_state() {
    const VIEWER: &str = "query Viewer { user { id } }";
    block_on(async {
        let occurrence = timed("e1", "l1", MONDAY_MS, MONDAY_MS + HOUR_MS);
        let mut engine = seeded(vec![occurrence]).await;
        engine
            .write_query(
                None,
                VIEWER,
                None,
                &Default::default(),
                &json!({"user": {"id": "u1"}}),
                Some("u1"),
            )
            .await
            .unwrap();
        engine
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 1)],
                }),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let write = engine
            .write_query(
                None,
                VIEWER,
                None,
                &Default::default(),
                &json!({"user": {"id": "u2"}}),
                Some("u2"),
            )
            .await
            .unwrap();
        assert!(write.reset);
        let result = engine.calendar_range(&week()).await.unwrap();
        assert!(result.occurrence_keys.is_empty());
        assert_eq!(result.gaps, week_coverage());
        assert_eq!(result.watermark, None);

        engine
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        engine.clear().await.unwrap();
        assert_eq!(
            engine.calendar_range(&week()).await.unwrap().gaps,
            week_coverage()
        );
    });
}

#[test]
fn invalid_requests_and_commits_are_rejected_before_storage() {
    block_on(async {
        let mut engine = seeded(Vec::new()).await;
        let mut inverted = week();
        inverted.end_ms = inverted.start_ms - 1;
        assert!(engine.calendar_range(&inverted).await.is_err());
        let revision = engine.current_revision();
        assert!(
            engine
                .calendar_commit(&CalendarCommit {
                    deleted_event_keys: vec![key("GraphqlCalendarOccurrence:e1:k")],
                    ..CalendarCommit::default()
                })
                .await
                .is_err()
        );
        assert_eq!(engine.current_revision(), revision);
    });
}

const OCCURRENCES: &str = r#"
query CalendarOccurrences($input: CalendarRangeInput!) {
  user {
    id
    calendarOccurrences(input: $input) {
      nodes {
        __typename
        id
        eventId
        linkId
        occurrenceKey
        isCancelled
        time {
          __typename
          ... on GraphqlTimedEventTime { startsAt endsAt timeZone }
          ... on GraphqlAllDayEventTime { startDate endDate }
        }
        event { __typename id linkId title }
      }
      hasNextPage
      endCursor
      syncStatus
      watermark { linkId seq }
    }
  }
}
"#;

fn occurrence_node(
    event: &str,
    key: &str,
    time: serde_json::Value,
    cancelled: bool,
) -> serde_json::Value {
    json!({
        "__typename": "GraphqlCalendarOccurrence",
        "id": format!("{event}:{key}"),
        "eventId": event,
        "linkId": "l1",
        "occurrenceKey": key,
        "isCancelled": cancelled,
        "time": time,
        "event": { "__typename": "GraphqlCalendarEvent", "id": event, "linkId": "l1", "title": event },
    })
}

fn occurrence_page(nodes: Vec<serde_json::Value>) -> serde_json::Value {
    json!({
        "user": {
            "id": "u1",
            "calendarOccurrences": {
                "nodes": nodes,
                "hasNextPage": false,
                "endCursor": null,
                "syncStatus": "READY",
                "watermark": [{ "linkId": "l1", "seq": "4" }],
            }
        }
    })
}

#[test]
fn network_pages_are_indexed_through_normalization() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let Json::Object(variables) = json!({
            "input": { "start": iso(MONDAY_MS), "end": iso(MONDAY_MS + 7 * DAY_MS) }
        }) else {
            unreachable!()
        };
        let standup = iso(MONDAY_MS + 9 * HOUR_MS);
        let page = occurrence_page(vec![
            occurrence_node(
                "e1",
                &standup,
                json!({
                    "__typename": "GraphqlTimedEventTime",
                    "startsAt": standup,
                    "endsAt": iso(MONDAY_MS + 10 * HOUR_MS),
                    "timeZone": "America/New_York",
                }),
                false,
            ),
            occurrence_node(
                "e2",
                &date(MONDAY_DAY + 2),
                json!({
                    "__typename": "GraphqlAllDayEventTime",
                    "startDate": date(MONDAY_DAY + 2),
                    "endDate": date(MONDAY_DAY + 3),
                }),
                false,
            ),
            occurrence_node(
                "e3",
                &date(MONDAY_DAY + 4),
                json!({
                    "__typename": "GraphqlAllDayEventTime",
                    "startDate": date(MONDAY_DAY + 4),
                    "endDate": date(MONDAY_DAY + 5),
                }),
                true,
            ),
        ]);
        engine
            .write_query(None, OCCURRENCES, None, &variables, &page, Some("u1"))
            .await
            .unwrap();
        let result = engine.calendar_range(&week()).await.unwrap();
        assert_eq!(
            result.occurrence_keys,
            [
                key(&format!("GraphqlCalendarOccurrence:e1:{standup}")),
                key(&format!(
                    "GraphqlCalendarOccurrence:e2:{}",
                    date(MONDAY_DAY + 2)
                )),
            ]
        );

        // The delta rewrites e1 later in the week and commits its full set.
        let moved = iso(MONDAY_MS + 2 * DAY_MS + 9 * HOUR_MS);
        let moved_page = occurrence_page(vec![occurrence_node(
            "e1",
            &moved,
            json!({
                "__typename": "GraphqlTimedEventTime",
                "startsAt": moved,
                "endsAt": iso(MONDAY_MS + 2 * DAY_MS + 10 * HOUR_MS),
                "timeZone": null,
            }),
            false,
        )]);
        engine
            .write_query(None, OCCURRENCES, None, &variables, &moved_page, Some("u1"))
            .await
            .unwrap();
        let commit = engine
            .calendar_commit(&CalendarCommit {
                replaced_events: vec![CalendarReplacedEvent {
                    event_key: key("GraphqlCalendarEvent:e1"),
                    occurrence_keys: vec![key(&format!("GraphqlCalendarOccurrence:e1:{moved}"))],
                }],
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        assert_eq!(
            commit.changed.into_iter().collect::<Vec<_>>(),
            [key(&format!("GraphqlCalendarOccurrence:e1:{standup}"))]
        );
        let mut only_e1 = week();
        only_e1.event_key = Some(key("GraphqlCalendarEvent:e1"));
        assert_eq!(
            engine
                .calendar_range(&only_e1)
                .await
                .unwrap()
                .occurrence_keys,
            [key(&format!("GraphqlCalendarOccurrence:e1:{moved}"))]
        );
    });
}
