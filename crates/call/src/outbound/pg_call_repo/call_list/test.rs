//! The call list over `fixtures/call_list.sql`: which calls a viewer sees
//! through each filter, their order and pages, and who was on them.

use std::sync::Arc;

use chrono::{DateTime, TimeZone, Utc};
use filter_ast::Expr;
use item_filters::{
    CallStatus,
    ast::{LiteralTree, call::CallLiteral},
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use crate::domain::models::{CallDiscussion, CallRecord, CallRecordPage};
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::PgCallRepo;

const VIEWER: &str = "macro|viewer@example.com";
const OTHER: &str = "macro|other@example.com";

const CH_MEMBER: Uuid = Uuid::from_u128(0xc1);
const CH_OTHER: Uuid = Uuid::from_u128(0xc2);
const CH_LEFT: Uuid = Uuid::from_u128(0xc3);

const A1: Uuid = Uuid::from_u128(0xca01);
const L1: Uuid = Uuid::from_u128(0xca02);
const A2: Uuid = Uuid::from_u128(0xca03);
const S1: Uuid = Uuid::from_u128(0xca04);
const S2: Uuid = Uuid::from_u128(0xca05);
const I1: Uuid = Uuid::from_u128(0xca06);
const I2: Uuid = Uuid::from_u128(0xca07);
const X1: Uuid = Uuid::from_u128(0xca08);
const A3: Uuid = Uuid::from_u128(0xca09);

const ALL_CALLS: [Uuid; 9] = [A1, L1, A2, S1, S2, I1, I2, X1, A3];
/// The viewer's calls by last activity, newest first.
const BY_ACTIVITY: [Uuid; 5] = [A2, L1, A1, I1, S2];
/// The viewer's calls by start, newest first.
const BY_START: [Uuid; 5] = [L1, A1, I1, A2, S2];

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn page(by_start: bool) -> CallRecordPage {
    CallRecordPage {
        by_start,
        after: None,
    }
}

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, hour, minute, 0).unwrap()
}

/// The filter a CRM record's Calls tab sends: an OR over its calls.
fn call_ids(ids: &[Uuid]) -> LiteralTree<CallLiteral> {
    ids.iter()
        .map(|id| Expr::val(CallLiteral::CallId(*id)))
        .reduce(Expr::or)
        .map(Arc::new)
}

fn channel(id: Uuid) -> LiteralTree<CallLiteral> {
    Some(Arc::new(Expr::val(CallLiteral::ChannelId(id))))
}

async fn list(
    pool: &Pool<Postgres>,
    filter: &LiteralTree<CallLiteral>,
    limit: u32,
    page: CallRecordPage,
) -> anyhow::Result<Vec<CallRecord>> {
    Ok(PgCallRepo::new(pool.clone())
        .get_call_records_by_user(user(VIEWER), limit, filter, page)
        .await?)
}

fn ids(records: &[CallRecord]) -> Vec<Uuid> {
    records.iter().map(|record| record.call_id).collect()
}

fn record(records: &[CallRecord], call_id: Uuid) -> &CallRecord {
    records
        .iter()
        .find(|record| record.call_id == call_id)
        .unwrap_or_else(|| panic!("{call_id} is not listed"))
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn lists_the_calls_the_viewer_can_see_in_both_orders(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_eq!(
        ids(&list(&pool, &None, 50, page(false)).await?),
        BY_ACTIVITY
    );
    assert_eq!(ids(&list(&pool, &None, 50, page(true)).await?), BY_START);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn call_id_filter_keeps_the_visibility_rules(pool: Pool<Postgres>) -> anyhow::Result<()> {
    // Naming a call doesn't grant it: a standalone call still needs the
    // viewer's own grant, and a channel the viewer left grants nothing.
    let records = list(&pool, &call_ids(&ALL_CALLS), 50, page(false)).await?;
    assert_eq!(ids(&records), BY_ACTIVITY);

    let records = list(&pool, &call_ids(&[S1, I2, X1, A3]), 50, page(false)).await?;
    assert_eq!(ids(&records), Vec::<Uuid>::new());

    // A record with no calls sends the nil id.
    let records = list(&pool, &call_ids(&[Uuid::nil()]), 50, page(false)).await?;
    assert_eq!(ids(&records), Vec::<Uuid>::new());

    let records = list(&pool, &call_ids(&[S2, A2, L1]), 50, page(true)).await?;
    assert_eq!(ids(&records), vec![L1, A2, S2]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn channel_filter_lists_the_channels_visible_calls(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    assert_eq!(
        ids(&list(&pool, &channel(CH_MEMBER), 50, page(false)).await?),
        vec![L1, A1]
    );
    // A2 through the team grant; X1 has no grant the viewer holds.
    assert_eq!(
        ids(&list(&pool, &channel(CH_OTHER), 50, page(false)).await?),
        vec![A2]
    );
    assert_eq!(
        ids(&list(&pool, &channel(CH_LEFT), 50, page(false)).await?),
        Vec::<Uuid>::new()
    );

    // Both filters: the named calls in the channel.
    let both = Some(Arc::new(Expr::and(
        Expr::val(CallLiteral::ChannelId(CH_MEMBER)),
        Expr::or(
            Expr::val(CallLiteral::CallId(A1)),
            Expr::val(CallLiteral::CallId(A2)),
        ),
    )));
    assert_eq!(ids(&list(&pool, &both, 50, page(false)).await?), vec![A1]);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn pages_reach_every_live_archived_and_imported_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    for (by_start, expected) in [(false, BY_ACTIVITY), (true, BY_START)] {
        for filter in [None, call_ids(&ALL_CALLS)] {
            let mut seen = Vec::new();
            let mut cursor = page(by_start);
            loop {
                let records = list(&pool, &filter, 2, cursor).await?;
                let Some(last) = records.last() else { break };
                seen.extend(ids(&records));
                let sort_at = if by_start {
                    last.started_at
                } else {
                    last.ended_at.unwrap_or(last.started_at)
                };
                cursor.after = Some((sort_at, last.call_id));
                assert!(seen.len() <= expected.len(), "a call repeated: {seen:?}");
            }
            assert_eq!(seen, expected, "by_start={by_start}, filter={filter:?}");
        }
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn reads_each_kind_of_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let records = list(&pool, &None, 50, page(false)).await?;

    let archived = record(&records, A1);
    assert!(!archived.is_active);
    assert_eq!(archived.room_name.as_deref(), Some("room-a1"));
    assert_eq!(archived.ended_at, Some(at(10, 30)));
    assert_eq!(archived.duration_ms, Some(1_800_000));
    assert_eq!(archived.status, Some(CallStatus::Attended));
    assert_eq!(archived.channel_name.as_deref(), Some("member"));
    assert_eq!(
        archived.discussion,
        CallDiscussion::CallChat { call_id: A1 }
    );

    let live = record(&records, L1);
    assert!(live.is_active);
    assert_eq!(live.started_at, at(11, 0));
    assert_eq!(live.ended_at, None);
    assert_eq!(live.status, Some(CallStatus::Missed));

    let shared = record(&records, A2);
    assert_eq!(shared.status, Some(CallStatus::Unattended));
    assert_eq!(shared.channel_name.as_deref(), Some("other"));
    assert_eq!(
        shared.discussion,
        CallDiscussion::ChannelThread {
            channel_id: CH_OTHER,
            root_id: A2,
        }
    );

    let imported = record(&records, I1);
    assert!(!imported.is_active);
    assert_eq!(imported.created_by, VIEWER);
    assert_eq!(imported.custom_name.as_deref(), Some("Imported review"));
    // No start time: the import time stands in.
    assert_eq!(imported.started_at, at(9, 30));
    assert_eq!(imported.status, Some(CallStatus::Attended));
    assert_eq!(imported.channel_id, None);
    assert_eq!(imported.channel_name, None);

    let standalone = record(&records, S2);
    assert_eq!(standalone.channel_id, None);
    assert_eq!(standalone.status, Some(CallStatus::Unattended));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_list")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn loads_everyone_on_each_call_in_join_order(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let records = list(&pool, &None, 50, page(false)).await?;
    let participants = |call_id| {
        record(&records, call_id)
            .participants
            .iter()
            .map(|p| (p.user_id.clone(), p.joined_at, p.left_at))
            .collect::<Vec<_>>()
    };
    let guests = |call_id| {
        record(&records, call_id)
            .guests
            .iter()
            .map(|g| {
                (
                    g.id.as_uuid(),
                    g.display_name.clone(),
                    g.joined_at,
                    g.left_at,
                )
            })
            .collect::<Vec<_>>()
    };

    assert_eq!(
        participants(A1),
        vec![
            (OTHER.to_string(), at(10, 0), Some(at(10, 30))),
            (VIEWER.to_string(), at(10, 1), Some(at(10, 20))),
        ]
    );
    // Guests who joined together keep their id order.
    assert_eq!(
        guests(A1),
        vec![
            (
                Uuid::from_u128(0xb1),
                "Guest One".into(),
                at(10, 5),
                Some(at(10, 15))
            ),
            (
                Uuid::from_u128(0xb2),
                "Guest Two".into(),
                at(10, 5),
                Some(at(10, 25))
            ),
        ]
    );

    assert_eq!(participants(L1), vec![(OTHER.to_string(), at(11, 0), None)]);
    assert_eq!(
        guests(L1),
        vec![(Uuid::from_u128(0xb3), "Live Guest".into(), at(11, 2), None)]
    );

    // Imported attendees are guests named by their name, else their email.
    assert_eq!(participants(I1), Vec::new());
    assert_eq!(
        guests(I1),
        vec![
            (
                Uuid::from_u128(0xe1),
                "grace@example.com".into(),
                at(9, 30),
                None
            ),
            (Uuid::from_u128(0xe2), "Participant".into(), at(9, 30), None),
            (Uuid::from_u128(0xe3), "Ada".into(), at(9, 30), None),
        ]
    );

    assert_eq!(participants(S2), Vec::new());
    assert_eq!(guests(S2), Vec::new());
    Ok(())
}
