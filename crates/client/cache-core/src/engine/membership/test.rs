//! Derivation rules for declared relation lists, through the public engine API.

use super::*;
use crate::engine::watch_query::{QueryPatch, QueryUpdate, WatchOptions};
use crate::identity::IdentityBinding;
use crate::queue::{MutationClaimRequest, MutationClaimToken};
use crate::store::InMemoryStorage;
use pollster::block_on;
use serde_json::json;

const FAVORITES: &str = "query Favorites($filter: FavoritesFilterInput) { user { id favorites(filter: $filter) { __typename id entityType entityId sortOrder createdAt } } }";
const SET_FAVORITE: &str = "mutation SetFavorite($entity: EntityRefInput!, $favorite: Boolean!) { setFavorite(entity: $entity, favorite: $favorite) { favorite { __typename id entityType entityId sortOrder createdAt } } }";
const DOCUMENTS: &str = r#"{"filter": {"entityTypes": ["DOCUMENT"], "entityIds": []}}"#;
const ALL: &str = r#"{"filter": null}"#;

type Engine = super::Engine<InMemoryStorage>;

fn vars(json: &str) -> serde_json::Map<String, Json> {
    serde_json::from_str(json).unwrap()
}

fn favorite(id: &str, entity_type: &str, sort_order: f64) -> Json {
    json!({
        "__typename": "GraphqlFavorite", "id": id, "entityType": entity_type,
        "entityId": id, "sortOrder": sort_order, "createdAt": "2026-10-01T00:00:00Z"
    })
}

/// A server response for one filter, listing these favorites.
async fn fetch(engine: &mut Engine, filter: &str, favorites: &[Json]) {
    engine
        .write_query(
            None,
            FAVORITES,
            None,
            &vars(filter),
            &json!({"user": {"id": "viewer", "favorites": favorites}}),
            None,
        )
        .await
        .unwrap();
}

/// A server write of one favorite outside the list, like a push or another
/// context's committed mutation.
async fn push(engine: &mut Engine, favorite: Json) {
    engine
        .write_query(
            None,
            SET_FAVORITE,
            None,
            &vars(r#"{"entity": {"type": "DOCUMENT", "id": "x"}, "favorite": true}"#),
            &json!({"setFavorite": {"favorite": favorite}}),
            None,
        )
        .await
        .unwrap();
}

async fn ids(engine: &mut Engine, filter: &str) -> Vec<String> {
    let ReadResult::Hit { data } = engine
        .read_query(None, FAVORITES, None, &vars(filter))
        .await
        .unwrap()
    else {
        panic!("favorites miss");
    };
    data["user"]["favorites"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["id"].as_str().unwrap().to_owned())
        .collect()
}

async fn enqueue(
    engine: &mut Engine,
    uuid: &str,
    favorite: Option<Json>,
    bindings: &[IdentityBinding],
) -> OptimisticTransactionId {
    engine
        .begin_optimistic_write(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid,
                query: SET_FAVORITE,
                operation_name: None,
                variables: &vars(
                    r#"{"entity": {"type": "DOCUMENT", "id": "x"}, "favorite": true}"#,
                ),
                data: &json!({"setFavorite": {"favorite": favorite}}),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: bindings,
            },
        )
        .await
        .unwrap()
        .0
}

async fn claim(engine: &mut Engine) -> MutationClaimToken {
    let claimed = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "runner".into(),
            now_ms: 0,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    MutationClaimToken {
        owner: "runner".into(),
        generation: claimed.lease_generation,
    }
}

async fn watch(engine: &mut Engine, since: Option<CacheRevision>) -> QueryUpdate {
    engine
        .watch_query_with_options(
            1,
            FAVORITES,
            None,
            &vars(ALL),
            &[],
            since,
            WatchOptions { splices: true },
        )
        .await
        .unwrap()
}

fn deleted(id: &str) -> IdentityBinding {
    IdentityBinding {
        local_key: EntityKey::entity("GraphqlFavorite", &[id]),
        delete_record: true,
        response_path: vec![],
        reference_fields: vec![],
        revalidation_variables: vec![],
    }
}

#[test]
fn evidence_wins_for_records_it_already_saw() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        // Cached before the evidence and unchanged since: the server ruled it out.
        push(&mut engine, favorite("seen", "DOCUMENT", 5.0)).await;
        fetch(&mut engine, DOCUMENTS, &[favorite("a", "DOCUMENT", 1.0)]).await;
        assert_eq!(ids(&mut engine, DOCUMENTS).await, ["a"]);
        // Changed after the evidence: evaluated locally and placed in order.
        push(&mut engine, favorite("later", "DOCUMENT", 0.5)).await;
        push(&mut engine, favorite("chat", "CHAT", 0.0)).await;
        assert_eq!(ids(&mut engine, DOCUMENTS).await, ["later", "a"]);
        // The unfiltered list has its own evidence and rules.
        fetch(&mut engine, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        push(&mut engine, favorite("seen", "DOCUMENT", 5.0)).await;
        assert_eq!(
            ids(&mut engine, ALL).await,
            ["a"],
            "an unchanged write is no change"
        );
        push(&mut engine, favorite("seen", "DOCUMENT", 6.0)).await;
        assert_eq!(ids(&mut engine, ALL).await, ["a", "seen"]);
        // Newer evidence wins again, even when its list is unchanged.
        fetch(&mut engine, DOCUMENTS, &[favorite("a", "DOCUMENT", 1.0)]).await;
        assert_eq!(ids(&mut engine, DOCUMENTS).await, ["a"]);
    });
}

#[test]
fn newer_unchanged_evidence_wakes_readers_beneath_pending_layers() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        fetch(&mut engine, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        push(&mut engine, favorite("b", "DOCUMENT", 2.0)).await;
        engine
            .read_query(Some(7), FAVORITES, None, &vars(ALL))
            .await
            .unwrap();
        // An unrelated pending write takes the optimistic write path.
        enqueue(
            &mut engine,
            "33333333-3333-4333-8333-333333333333",
            Some(favorite("c", "CHAT", 3.0)),
            &[],
        )
        .await;
        assert_eq!(ids(&mut engine, ALL).await, ["a", "b", "c"]);
        // The server lists the same evidence: only its stamp changes.
        let refetch = engine
            .write_query(
                None,
                FAVORITES,
                None,
                &vars(ALL),
                &json!({"user": {"id": "viewer", "favorites": [favorite("a", "DOCUMENT", 1.0)]}}),
                None,
            )
            .await
            .unwrap();
        assert!(refetch.affected_ops.contains(&7));
        assert_eq!(ids(&mut engine, ALL).await, ["a", "c"]);
    });
}

#[test]
fn optimistic_layers_are_evaluated_locally_and_roll_back() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let a = favorite("a", "DOCUMENT", 1.0);
        let b = favorite("b", "DOCUMENT", 2.0);
        fetch(&mut engine, DOCUMENTS, &[a.clone(), b.clone()]).await;
        fetch(&mut engine, ALL, &[a, b]).await;
        // A pending add appends in every list it matches.
        let add = enqueue(
            &mut engine,
            "11111111-1111-4111-8111-111111111111",
            Some(favorite("c", "DOCUMENT", 3.0)),
            &[],
        )
        .await;
        assert_eq!(ids(&mut engine, DOCUMENTS).await, ["a", "b", "c"]);
        assert_eq!(ids(&mut engine, ALL).await, ["a", "b", "c"]);
        // A pending delete hides a member everywhere.
        enqueue(
            &mut engine,
            "22222222-2222-4222-8222-222222222222",
            None,
            &[deleted("a")],
        )
        .await;
        assert_eq!(ids(&mut engine, ALL).await, ["b", "c"]);
        // A rejected add rolls back without any recipe.
        let token = claim(&mut engine).await;
        engine.rollback_optimistic_write(add, token).await.unwrap();
        assert_eq!(ids(&mut engine, ALL).await, ["b"]);
        assert_eq!(ids(&mut engine, DOCUMENTS).await, ["b"]);
    });
}

#[test]
fn committed_responses_and_server_identities_replace_predictions() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        fetch(&mut engine, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        // A local identity the server replaces on commit, with its real order.
        let local = enqueue(
            &mut engine,
            "11111111-1111-4111-8111-111111111111",
            Some(favorite("local", "DOCUMENT", 9.0)),
            &[IdentityBinding {
                local_key: EntityKey::entity("GraphqlFavorite", &["local"]),
                delete_record: false,
                response_path: vec!["setFavorite".into(), "favorite".into()],
                reference_fields: vec![],
                revalidation_variables: vec![],
            }],
        )
        .await;
        assert_eq!(ids(&mut engine, ALL).await, ["a", "local"]);
        let token = claim(&mut engine).await;
        engine
            .commit_optimistic_write(
                local,
                token,
                SET_FAVORITE,
                None,
                &vars(r#"{"entity": {"type": "DOCUMENT", "id": "x"}, "favorite": true}"#),
                &json!({"setFavorite": {"favorite": favorite("document:x", "DOCUMENT", 0.0)}}),
            )
            .await
            .unwrap();
        assert_eq!(ids(&mut engine, ALL).await, ["document:x", "a"]);
    });
}

#[test]
fn derived_membership_and_stamps_survive_a_restart() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        fetch(&mut engine, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        push(&mut engine, favorite("b", "DOCUMENT", 2.0)).await;
        assert_eq!(ids(&mut engine, ALL).await, ["a", "b"]);
        let mut restarted = Engine::new(engine.into_storage());
        let scans = restarted.storage().type_scan_count();
        assert_eq!(ids(&mut restarted, ALL).await, ["a", "b"]);
        assert_eq!(restarted.storage().type_scan_count(), scans + 1);
        // The index loads once; later pushes update it in place.
        push(&mut restarted, favorite("c", "DOCUMENT", 3.0)).await;
        assert_eq!(ids(&mut restarted, ALL).await, ["a", "b", "c"]);
        assert_eq!(restarted.storage().type_scan_count(), scans + 1);
        // A new clock continues past the stored one, so the refetch still wins.
        fetch(&mut restarted, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        assert_eq!(ids(&mut restarted, ALL).await, ["a"]);
    });
}

#[test]
fn unknown_membership_keeps_evidence_and_flags_the_watch() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        fetch(&mut engine, DOCUMENTS, &[favorite("a", "DOCUMENT", 1.0)]).await;
        // A favorite written by a selection without the filtered field.
        engine
            .write_query(
                None,
                "mutation SetFavorite($entity: EntityRefInput!, $favorite: Boolean!) { setFavorite(entity: $entity, favorite: $favorite) { favorite { __typename id sortOrder } } }",
                None,
                &vars(r#"{"entity": {"type": "DOCUMENT", "id": "x"}, "favorite": true}"#),
                &json!({"setFavorite": {"favorite": {"__typename": "GraphqlFavorite", "id": "partial", "sortOrder": 0}}}),
                None,
            )
            .await
            .unwrap();
        let update = engine
            .watch_query(1, FAVORITES, None, &vars(DOCUMENTS), &[], None)
            .await
            .unwrap();
        let QueryUpdate::Hit {
            data,
            membership_unknown,
            ..
        } = update
        else {
            panic!("expected a hit");
        };
        assert!(membership_unknown);
        assert_eq!(data["user"]["favorites"][0]["id"], "a");
        assert_eq!(data["user"]["favorites"].as_array().unwrap().len(), 1);
        // The unfiltered list does not depend on the missing field.
        fetch(&mut engine, ALL, &[favorite("a", "DOCUMENT", 1.0)]).await;
        push(&mut engine, favorite("b", "DOCUMENT", 2.0)).await;
        assert_eq!(ids(&mut engine, ALL).await, ["a", "b"]);
    });
}

#[test]
fn watched_lists_splice_pushes_and_wake_registered_operations() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let rows: Vec<_> = (0..5)
            .map(|index| favorite(&format!("f{index}"), "DOCUMENT", index as f64))
            .collect();
        fetch(&mut engine, ALL, &rows).await;
        let first = watch(&mut engine, None).await;
        let QueryUpdate::Hit { revision, .. } = first else {
            panic!("expected a snapshot");
        };
        // Registered readers of the list are affected by a record they never read.
        engine
            .read_query(Some(2), FAVORITES, None, &vars(ALL))
            .await
            .unwrap();
        let pushed = engine
            .write_query(
                None,
                SET_FAVORITE,
                None,
                &vars(r#"{"entity": {"type": "DOCUMENT", "id": "x"}, "favorite": true}"#),
                &json!({"setFavorite": {"favorite": favorite("new", "DOCUMENT", 2.5)}}),
                None,
            )
            .await
            .unwrap();
        assert!(pushed.affected_ops.contains(&2));
        let QueryUpdate::Patch {
            patches, revision, ..
        } = watch(&mut engine, Some(revision.parse().unwrap())).await
        else {
            panic!("expected a patch");
        };
        assert_eq!(
            serde_json::to_value(&patches).unwrap(),
            json!([{"path": ["user", "favorites"], "splice": [
                {"insert": 3, "value": favorite("new", "DOCUMENT", 2.5)}
            ]}])
        );
        // A reorder moves a row instead of resending the list.
        push(&mut engine, favorite("f0", "DOCUMENT", 10.0)).await;
        let QueryUpdate::Patch { patches, .. } =
            watch(&mut engine, Some(revision.parse().unwrap())).await
        else {
            panic!("expected a patch");
        };
        assert!(matches!(
            patches.as_slice(),
            [QueryPatch::Splice(splice), QueryPatch::Set(sort)]
                if serde_json::to_value(&splice.splice).unwrap() == json!([{"move": 0, "to": 5}])
                    && sort.value == json!(10.0)
        ));
    });
}
