use super::*;
use cache_core::calendar::{CalendarLinkWatermark, CalendarReplacedEvent, CalendarWatermarkUpdate};
use pollster::block_on;
use std::collections::BTreeMap;

const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
// 2026-10-05T00:00:00Z
const MONDAY_MS: i64 = 1_791_158_400_000;
const MONDAY_DAY: i64 = 20_731;

fn key(value: &str) -> EntityKey<'static> {
    EntityKey(value.to_owned().into())
}

fn string(value: &str) -> CacheValue {
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

fn occurrence(event: &str, link: &str, time: Vec<(&str, String)>) -> Record {
    let mut record = Record::default();
    for (field, value) in [
        ("__typename", string(OCCURRENCE_TYPENAME)),
        ("eventId", string(event)),
        ("linkId", string(link)),
        ("isCancelled", CacheValue::Bool(false)),
        (
            "time",
            CacheValue::Object(
                time.into_iter()
                    .map(|(field, value)| (field.to_owned(), CacheValue::String(value)))
                    .collect::<BTreeMap<_, _>>(),
            ),
        ),
    ] {
        record.fields.insert(field.into(), value);
    }
    record
}

fn timed(event: &str, link: &str, start_ms: i64, end_ms: i64) -> (EntityKey<'static>, Record) {
    (
        key(&format!("{OCCURRENCE_TYPENAME}:{event}:{}", iso(start_ms))),
        occurrence(
            event,
            link,
            vec![
                ("__typename", "GraphqlTimedEventTime".into()),
                ("startsAt", iso(start_ms)),
                ("endsAt", iso(end_ms)),
            ],
        ),
    )
}

fn all_day(event: &str, link: &str, start_day: i64, end_day: i64) -> (EntityKey<'static>, Record) {
    (
        key(&format!(
            "{OCCURRENCE_TYPENAME}:{event}:{}",
            date(start_day)
        )),
        occurrence(
            event,
            link,
            vec![
                ("__typename", "GraphqlAllDayEventTime".into()),
                ("startDate", date(start_day)),
                ("endDate", date(end_day)),
            ],
        ),
    )
}

fn linked(typename: &str, id: &str, link: &str) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    record.fields.insert("__typename".into(), string(typename));
    record.fields.insert("linkId".into(), string(link));
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
    week().spans().to_vec()
}

fn link(link_id: &str, seq: i64) -> CalendarLinkWatermark {
    CalendarLinkWatermark {
        link_id: link_id.into(),
        seq,
    }
}

fn keys(snapshot: &CalendarRangeSnapshot) -> Vec<String> {
    let mut keys = snapshot
        .rows
        .iter()
        .map(|row| row.record_key.as_ref().to_owned())
        .collect::<Vec<_>>();
    keys.sort();
    keys
}

fn raw_execute(storage: &TursoStorage, sql: &str) {
    driver::execute(&storage.connection(), sql, Vec::new()).unwrap();
}

fn row_count(storage: &TursoStorage) -> i64 {
    let rows = driver::query(
        &storage.connection(),
        "SELECT COUNT(*) FROM calendar_ranges",
        Vec::new(),
    )
    .unwrap();
    required_i64(&rows[0], 0).unwrap()
}

#[test]
fn range_rows_are_written_through_with_records() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("calendar-write-through").unwrap();
        let inside = timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let long = timed("e2", "l1", MONDAY_MS - 20 * DAY_MS, MONDAY_MS + HOUR_MS);
        let before = timed("e3", "l1", MONDAY_MS - 2 * HOUR_MS, MONDAY_MS);
        let holiday = all_day("e4", "l1", MONDAY_DAY + 3, MONDAY_DAY + 4);
        storage
            .put_batch(vec![
                inside.clone(),
                long.clone(),
                before,
                holiday.clone(),
                linked(EVENT_TYPENAME, "e1", "l1"),
            ])
            .await
            .unwrap();
        assert_eq!(row_count(&storage), 4);
        let mut expected = vec![
            inside.0.as_ref().to_owned(),
            long.0.as_ref().to_owned(),
            holiday.0.as_ref().to_owned(),
        ];
        expected.sort();
        assert_eq!(
            keys(&storage.query_calendar_ranges(&week()).await.unwrap()),
            expected
        );

        let mut cancelled = inside.1.clone();
        cancelled
            .fields
            .insert("isCancelled".into(), CacheValue::Bool(true));
        storage
            .put_batch(vec![
                (inside.0.clone(), inside.1.clone()),
                (inside.0.clone(), cancelled),
            ])
            .await
            .unwrap();
        storage
            .delete_batch(std::slice::from_ref(&holiday.0))
            .await
            .unwrap();
        assert_eq!(
            keys(&storage.query_calendar_ranges(&week()).await.unwrap()),
            [long.0.as_ref().to_owned()]
        );

        let mut only_e2 = week();
        only_e2.event_key = Some(key("GraphqlCalendarEvent:e2"));
        assert_eq!(
            keys(&storage.query_calendar_ranges(&only_e2).await.unwrap()),
            [long.0.as_ref().to_owned()]
        );
        only_e2.start_ms = MONDAY_MS - 31 * DAY_MS;
        only_e2.end_ms = MONDAY_MS - 30 * DAY_MS;
        assert!(
            storage
                .query_calendar_ranges(&only_e2)
                .await
                .unwrap()
                .rows
                .is_empty()
        );
    });
}

#[test]
fn range_lookups_use_the_scan_index_without_touching_unrelated_rows() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("calendar-scan-cost").unwrap();
        storage
            .put_batch(vec![timed("e1", "l1", MONDAY_MS, MONDAY_MS + HOUR_MS)])
            .await
            .unwrap();
        let mut costs = Vec::new();
        for unrelated in [0, 5_000] {
            storage
                .put_batch(
                    (0..unrelated)
                        .map(|index| {
                            let start = MONDAY_MS + (30 + index) * DAY_MS;
                            timed(&format!("far-{index}"), "l1", start, start + HOUR_MS)
                        })
                        .collect(),
                )
                .await
                .unwrap();
            let mut statement = driver::prepare(&storage.connection(), RANGE_SHORT).unwrap();
            let rows = driver::query_prepared(
                &mut statement,
                vec![
                    Value::from_i64(0),
                    Value::from_i64(MONDAY_MS - 7 * DAY_MS),
                    Value::from_i64(MONDAY_MS + 7 * DAY_MS),
                    Value::from_i64(MONDAY_MS),
                ],
            )
            .unwrap();
            assert_eq!(rows.len(), 1);
            costs.push(statement.metrics().vm_steps);
        }
        assert!(
            costs[1] <= costs[0] + 50,
            "VM steps grew with unrelated rows: {costs:?}"
        );
        for sql in [RANGE_SHORT, RANGE_LONG, RANGE_BY_EVENT, RANGE_KEYS_BY_LINK] {
            let parameters = vec![
                Value::from_i64(0);
                driver::prepare(&storage.connection(), sql)
                    .unwrap()
                    .parameters_count()
            ];
            let plan = driver::query(
                &storage.connection(),
                &format!("EXPLAIN QUERY PLAN {sql}"),
                parameters,
            )
            .unwrap()
            .iter()
            .filter_map(|row| required_text(row, 3).ok())
            .collect::<Vec<_>>()
            .join(" ");
            assert!(plan.contains("calendar_ranges_"), "{sql}: {plan}");
        }
    });
}

#[test]
fn commits_delete_records_merge_coverage_and_persist_sync_state() {
    block_on(async {
        let database = TursoMemoryDatabase::new("calendar-commit.db");
        let mut storage = database.open("scope").unwrap();
        let kept = timed("e1", "l1", MONDAY_MS + HOUR_MS, MONDAY_MS + 2 * HOUR_MS);
        let stale = timed("e1", "l1", MONDAY_MS + DAY_MS, MONDAY_MS + DAY_MS + HOUR_MS);
        let deleted = timed("e2", "l1", MONDAY_MS + 3 * HOUR_MS, MONDAY_MS + 4 * HOUR_MS);
        let removed = timed("e3", "l2", MONDAY_MS + 5 * HOUR_MS, MONDAY_MS + 6 * HOUR_MS);
        let removed_event = linked(EVENT_TYPENAME, "e3", "l2");
        let removed_calendar = linked(CALENDAR_TYPENAME, "c2", "l2");
        let kept_calendar = linked(CALENDAR_TYPENAME, "c1", "l1");
        storage
            .put_batch(vec![
                kept.clone(),
                stale.clone(),
                deleted.clone(),
                removed.clone(),
                removed_event.clone(),
                removed_calendar.clone(),
                kept_calendar.clone(),
                linked(EVENT_TYPENAME, "e2", "l1"),
            ])
            .await
            .unwrap();
        let outcome = storage
            .calendar_commit(&CalendarCommit {
                coverage: vec![CalendarSpan {
                    kind: CalendarSpanKind::Timed,
                    start: MONDAY_MS,
                    end: MONDAY_MS + 3 * DAY_MS,
                }],
                replaced_events: vec![CalendarReplacedEvent {
                    event_key: key("GraphqlCalendarEvent:e1"),
                    occurrence_keys: vec![kept.0.clone()],
                }],
                deleted_event_keys: vec![key("GraphqlCalendarEvent:e2")],
                removed_link_ids: vec!["l2".into()],
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 9), link("l2", 3)],
                }),
                freshness: Some(CalendarFreshness::Fresh),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let mut expected = vec![
            removed_calendar.0.clone(),
            key("GraphqlCalendarEvent:e2"),
            removed_event.0.clone(),
            deleted.0.clone(),
            stale.0.clone(),
            removed.0.clone(),
        ];
        expected.sort();
        assert_eq!(outcome.deleted_keys, expected);
        storage
            .calendar_commit(&CalendarCommit {
                coverage: vec![CalendarSpan {
                    kind: CalendarSpanKind::Timed,
                    start: MONDAY_MS + 3 * DAY_MS,
                    end: MONDAY_MS + 7 * DAY_MS,
                }],
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        let snapshot = storage.query_calendar_ranges(&week()).await.unwrap();
        assert_eq!(keys(&snapshot), [kept.0.as_ref().to_owned()]);
        assert_eq!(
            snapshot.coverage,
            [CalendarSpan {
                kind: CalendarSpanKind::Timed,
                start: MONDAY_MS,
                end: MONDAY_MS + 7 * DAY_MS,
            }]
        );
        assert_eq!(
            snapshot.sync,
            CalendarSyncState {
                watermark: Some(vec![link("l1", 9)]),
                freshness: CalendarFreshness::Fresh,
            }
        );
        assert_eq!(
            storage
                .get_batch(&[kept_calendar.0, removed_calendar.0])
                .await
                .unwrap()
                .iter()
                .map(Option::is_some)
                .collect::<Vec<_>>(),
            [true, false]
        );
        storage.try_close().unwrap();
    });
}

#[test]
fn reset_and_clear_drop_calendar_state() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("calendar-reset").unwrap();
        let occurrence = timed("e1", "l1", MONDAY_MS, MONDAY_MS + HOUR_MS);
        let event = linked(EVENT_TYPENAME, "e1", "l1");
        let calendar = linked(CALENDAR_TYPENAME, "c1", "l1");
        storage
            .put_batch(vec![occurrence.clone(), event.clone(), calendar.clone()])
            .await
            .unwrap();
        storage
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 2)],
                }),
                freshness: Some(CalendarFreshness::Stale),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let outcome = storage
            .calendar_commit(&CalendarCommit {
                reset: true,
                watermark: Some(CalendarWatermarkUpdate::Advance {
                    since: vec![link("l1", 2)],
                    to: vec![link("l1", 20)],
                }),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        let mut expected = vec![event.0.clone(), occurrence.0.clone()];
        expected.sort();
        assert_eq!(outcome.deleted_keys, expected);
        let snapshot = storage.query_calendar_ranges(&week()).await.unwrap();
        assert!(snapshot.rows.is_empty() && snapshot.coverage.is_empty());
        assert_eq!(
            snapshot.sync,
            CalendarSyncState {
                watermark: Some(vec![link("l1", 20)]),
                freshness: CalendarFreshness::Unknown,
            }
        );
        assert!(storage.get_batch(&[calendar.0]).await.unwrap()[0].is_some());

        storage.put_batch(vec![occurrence]).await.unwrap();
        storage
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                freshness: Some(CalendarFreshness::Fresh),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        storage.clear().await.unwrap();
        assert_eq!(row_count(&storage), 0);
        assert_eq!(
            storage.query_calendar_ranges(&week()).await.unwrap(),
            CalendarRangeSnapshot::default()
        );
    });
}

#[test]
fn reopen_rebuilds_range_rows_after_a_projection_change() {
    block_on(async {
        let database = TursoMemoryDatabase::new("calendar-projection.db");
        let mut storage = database.open("scope").unwrap();
        let mut entries = (0..300)
            .map(|index| {
                let start = MONDAY_MS + index * HOUR_MS;
                timed(&format!("e{index:03}"), "l1", start, start + HOUR_MS)
            })
            .collect::<Vec<_>>();
        let point = timed("legacy-point", "l1", MONDAY_MS, MONDAY_MS);
        entries.push(point.clone());
        storage.put_batch(entries).await.unwrap();
        storage
            .calendar_commit(&CalendarCommit {
                coverage: week_coverage(),
                watermark: Some(CalendarWatermarkUpdate::Merge {
                    links: vec![link("l1", 4)],
                }),
                freshness: Some(CalendarFreshness::Fresh),
                ..CalendarCommit::default()
            })
            .await
            .unwrap();
        raw_execute(&storage, "DELETE FROM calendar_ranges");
        raw_execute(
            &storage,
            "UPDATE meta SET value = '1' WHERE key = 'calendar_projection_version'",
        );
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(row_count(&storage), 301);
        let snapshot = storage.query_calendar_ranges(&week()).await.unwrap();
        assert!(
            snapshot
                .rows
                .iter()
                .any(|row| row.record_key == point.0 && row.span.start == row.span.end)
        );
        assert_eq!(snapshot.coverage, week_coverage());
        assert_eq!(snapshot.sync.watermark, Some(vec![link("l1", 4)]));
        assert_eq!(snapshot.sync.freshness, CalendarFreshness::Fresh);
        assert!(storage.get_batch(&[point.0]).await.unwrap()[0].is_some());
        storage.try_close().unwrap();

        // A normal reopen neither scans nor decodes occurrence records.
        driver::arm_reset_failure(SEARCH_REBUILD_RECORDS);
        let storage = database.open("scope").unwrap();
        assert_eq!(row_count(&storage), 301);
        storage.try_close().unwrap();
    });
}

#[test]
fn reopen_rejects_a_calendar_schema_drift() {
    block_on(async {
        let database = TursoMemoryDatabase::new("calendar-schema.db");
        let storage = database.open("scope").unwrap();
        raw_execute(&storage, "DROP INDEX calendar_ranges_link_idx");
        storage.try_close().unwrap();
        let Err(error) = database.open("scope") else {
            panic!("a drifted calendar schema must not open");
        };
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Compatibility)
        );
    });
}

#[test]
fn invalid_commits_never_open_a_transaction() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("calendar-invalid").unwrap();
        let error = storage
            .calendar_commit(&CalendarCommit {
                deleted_calendar_keys: vec![key("GraphqlCalendarEvent:e1")],
                ..CalendarCommit::default()
            })
            .await
            .unwrap_err();
        assert!(!error.requires_physical_reset());
        assert!(
            storage
                .query_calendar_ranges(&week())
                .await
                .unwrap()
                .rows
                .is_empty()
        );
    });
}
