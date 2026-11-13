use cache_core::{
    engine::{Engine, HydrationScope, NetworkWrite},
    people::sql::{Outcome, PeopleSqlInput, PeopleSqlRequest, PeopleSqlResult},
    people::sync::ContactSnapshotRequest,
    store::Storage,
};
use serde_json::{Value, json};
use uuid::Uuid;

pub const VIEWER: &str = "macro|viewer@example.com";
const DOCUMENT: &str = include_str!(
    "../../../../../../apps/web/src/lib/service-clients/service-storage/graphql/contacts.graphql"
);

pub fn key(viewer: &str, user: &str) -> String {
    Uuid::new_v5(
        &Uuid::new_v5(&Uuid::NAMESPACE_OID, viewer.as_bytes()),
        user.as_bytes(),
    )
    .to_string()
}

/// Actual normalized hydration, with no directory-sized fixture even at 100k.
pub async fn seed<S: Storage>(engine: &mut Engine<S>, count: usize) -> HydrationScope {
    let mut scope = HydrationScope {
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
        contact_fence: None,
    };
    for start in (0..count + 1).step_by(500) {
        scope.contact_fence = Some(
            engine
                .contact_snapshot(&ContactSnapshotRequest {
                    scope: scope.clone(),
                    scan: None,
                })
                .await
                .unwrap()
                .fence,
        );
        let nodes: Vec<_> = (start..(start + 500).min(count + 1)).map(|index| {
            let user = if index == 0 { VIEWER.into() } else { format!("macro|p{:06}@example.com", index - 1) };
            json!({"id": key(VIEWER, &user), "userId": user, "email": user.strip_prefix("macro|").unwrap(), "name": if index == count { "LATE_ÉCHO%".into() } else { format!("Group{}", index % 7) }})
        }).collect();
        engine
            .hydrate_query_in_scope(NetworkWrite {
                query: DOCUMENT,
                operation_name: Some("ContactDirectoryBackfill"),
                variables: json!({"limit":500,"after":start.to_string()}).as_object().unwrap(),
                data: &json!({"user":{"id":VIEWER,"contacts":{"nodes":nodes,"nextCursor":null}}}),
                identity: Some(VIEWER),
            }, &scope, vec![])
            .await
            .unwrap();
    }
    HydrationScope {
        contact_fence: None,
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
    }
}

pub async fn read<S: Storage>(
    engine: &mut Engine<S>,
    scope: &HydrationScope,
    sql: &str,
) -> Outcome {
    #[cfg(not(target_arch = "wasm32"))]
    let started = std::time::Instant::now();
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!("local SQL start: {sql}");
    let PeopleSqlResult::Result { outcome } = engine
        .read_people_sql(&PeopleSqlRequest {
            scope: scope.clone(),
            input: PeopleSqlInput::Statement { sql: sql.into() },
        })
        .await
        .unwrap()
    else {
        panic!("expected local SQL result");
    };
    #[cfg(not(target_arch = "wasm32"))]
    eprintln!(
        "local SQL result: {:?}, rows={}",
        started.elapsed(),
        outcome.rows.len()
    );
    outcome
}

pub async fn contract<S: Storage>(
    mut engine: Engine<S>,
    scope: &HydrationScope,
    count: usize,
) -> Engine<S> {
    let counted = read(&mut engine, scope, "SELECT COUNT(*) FROM macro.people").await;
    assert_eq!(
        serde_json::to_value(counted.rows).unwrap(),
        json!([[{"type":"number","value":(count + 1) as f64}]])
    );
    assert!(!counted.truncated);
    let late = read(
        &mut engine,
        scope,
        "SELECT email FROM macro.people WHERE name LIKE 'late^_écho^%' ESCAPE '^'",
    )
    .await;
    assert_eq!(
        serde_json::to_value(late.rows).unwrap(),
        json!([[{"type":"text","value":format!("p{:06}@example.com",count - 1)}]])
    );
    let rows = read(
        &mut engine,
        scope,
        "SELECT id, name, email FROM macro.people ORDER BY email",
    )
    .await;
    assert_eq!(rows.rows.len(), (count + 1).min(500));
    assert_eq!(rows.row_ids.len(), rows.rows.len());
    assert_eq!(rows.truncated, count + 1 > 500);
    let limit = read(
        &mut engine,
        scope,
        "SELECT name FROM macro.people ORDER BY email DESC LIMIT 3 OFFSET 1",
    )
    .await;
    assert_eq!(limit.rows.len(), 3);
    assert!(!limit.truncated);
    let distinct = read(
        &mut engine,
        scope,
        "SELECT DISTINCT name FROM macro.people ORDER BY email DESC",
    )
    .await;
    assert_eq!(distinct.rows.len(), 8);
    assert!(!distinct.truncated);
    let grouped = read(
        &mut engine,
        scope,
        "SELECT name, COUNT(*) AS total FROM macro.people GROUP BY name ORDER BY total DESC, name",
    )
    .await;
    assert_eq!(grouped.rows.len(), 8);
    let groups = serde_json::to_value(grouped.rows).unwrap();
    let sum: f64 = groups
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row[1]["value"].as_f64().unwrap())
        .sum();
    assert_eq!(sum, (count + 1) as f64);
    let empty = read(
        &mut engine,
        scope,
        "SELECT COUNT(*) FROM macro.people WHERE name = 'absent'",
    )
    .await;
    assert_eq!(
        serde_json::to_value(empty.rows).unwrap(),
        json!([[{"type":"number","value":0.0}]])
    );
    let null = read(
        &mut engine,
        scope,
        "SELECT COUNT(row_position) FROM macro.people",
    )
    .await;
    assert_eq!(
        serde_json::to_value(null.rows).unwrap(),
        json!([[{"type":"number","value":0.0}]])
    );
    let virtuals = read(
        &mut engine,
        scope,
        "SELECT row_id, row_position FROM macro.people ORDER BY row_id LIMIT 2",
    )
    .await;
    assert_eq!(virtuals.rows.len(), 2);
    assert!(virtuals.rows.iter().all(|row| row[1].is_none()));
    for sql in [
        "DELETE FROM macro.people",
        "SELECT * FROM records",
        "SELECT p.name FROM macro.people p JOIN macro.people q ON p.id = q.id",
    ] {
        assert!(
            engine
                .read_people_sql(&PeopleSqlRequest {
                    scope: scope.clone(),
                    input: PeopleSqlInput::Statement { sql: sql.into() }
                })
                .await
                .is_err()
        );
    }
    let keyed = engine
        .read_people_sql(&PeopleSqlRequest {
            scope: scope.clone(),
            input: PeopleSqlInput::Identities {
                ids: vec!["macro|p000000@example.com".into()],
            },
        })
        .await
        .unwrap();
    let PeopleSqlResult::Result { outcome } = keyed else {
        panic!("keyed local read");
    };
    assert_eq!(outcome.rows.len(), 1);
    let mut obsolete = scope.clone();
    obsolete.storage_generation = Uuid::now_v7();
    assert!(
        engine
            .read_people_sql(&PeopleSqlRequest {
                scope: obsolete,
                input: PeopleSqlInput::Statement {
                    sql: "SELECT COUNT(*) FROM macro.people".into()
                }
            })
            .await
            .is_err()
    );
    let mut foreign = scope.clone();
    foreign.identity = "macro|other@example.com".into();
    assert!(
        engine
            .read_people_sql(&PeopleSqlRequest {
                scope: foreign,
                input: PeopleSqlInput::Statement {
                    sql: "SELECT name FROM macro.people".into()
                }
            })
            .await
            .is_err()
    );
    // Zero identities is not an unrestricted people scan.
    let empty = engine
        .read_people_sql(&PeopleSqlRequest {
            scope: scope.clone(),
            input: PeopleSqlInput::Identities { ids: vec![] },
        })
        .await
        .unwrap();
    let PeopleSqlResult::Result { outcome } = empty else {
        panic!("empty local read");
    };
    assert_eq!(
        serde_json::to_value(outcome.rows).unwrap(),
        Value::Array(vec![])
    );
    engine
}
