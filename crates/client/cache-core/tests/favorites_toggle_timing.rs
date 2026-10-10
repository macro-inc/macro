//! Prints the worker cost of one optimistic favorite toggle until every
//! mounted favorites list has its update: enqueue plus one watched read per
//! list. Ignored by default; run in release mode:
//! `cargo test --release -p cache-core --test favorites_toggle_timing -- --ignored --nocapture`
//!
//! `recipes` maintains every mounted list with a link recipe (the approach
//! before derived membership); `records` predicts only the favorite record.
//! Uses only APIs that predate derived membership, so it also runs on main.

use cache_core::engine::watch_query::QueryUpdate;
use cache_core::engine::{BeginOptimisticWrite, Engine};
use cache_core::link_patch::{LinkOperation, LinkPathSegment, OptimisticLinkPatch};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::revision::CacheRevision;
use cache_core::store::InMemoryStorage;
use cache_core::value::{EntityKey, canonical_json};
use pollster::block_on;
use serde_json::{Map, Value as Json, json};
use std::time::{Duration, Instant};

const FAVORITES: &str = "query Favorites($filter: FavoritesFilterInput) { user { id favorites(filter: $filter) { __typename id entityType entityId sortOrder createdAt fileType documentSubType channelType channelId } } }";
const SET_FAVORITE: &str = "mutation SetFavorite($entity: EntityRefInput!, $favorite: Boolean!) { setFavorite(entity: $entity, favorite: $favorite) { favorite { __typename id entityType entityId sortOrder createdAt fileType documentSubType channelType channelId } } }";
const SAMPLES: usize = 101;

fn micros(mut samples: Vec<Duration>) -> f64 {
    samples.sort();
    samples[samples.len() / 2].as_secs_f64() * 1e6
}

fn revision(update: &QueryUpdate) -> CacheRevision {
    match update {
        QueryUpdate::Hit { revision, .. }
        | QueryUpdate::Patch { revision, .. }
        | QueryUpdate::Miss { revision } => revision.parse().unwrap(),
    }
}

fn favorite(id: &str, entity_type: &str, sort: f64) -> Json {
    json!({
        "__typename": "GraphqlFavorite", "id": format!("{}:{id}", entity_type.to_lowercase()),
        "entityType": entity_type, "entityId": id, "sortOrder": sort,
        "createdAt": "2026-10-01T00:00:00Z", "fileType": "md",
        "documentSubType": null, "channelType": null, "channelId": null
    })
}

#[test]
#[ignore = "prints timings; run in release mode"]
fn favorite_toggle_costs() {
    println!("| mounted lists | favorites | mode | worker: enqueue + all list updates |");
    println!("|---:|---:|---|---:|");
    for (lists, count) in [(3, 50_usize), (3, 500)] {
        for recipes in [true, false] {
            block_on(async {
                let mut engine = Engine::new(InMemoryStorage::new());
                // The sidebar's unfiltered list plus two filtered rails.
                let filters = [
                    json!(null),
                    json!({"entityTypes": ["DOCUMENT"]}),
                    json!({"entityTypes": ["CHANNEL"]}),
                ];
                let variables: Vec<Map<String, Json>> = filters[..lists]
                    .iter()
                    .map(|filter| json!({"filter": filter}).as_object().unwrap().clone())
                    .collect();
                for (filter, variables) in filters.iter().zip(&variables) {
                    let favorites: Vec<_> = (0..count)
                        .map(|index| {
                            let channel = index.is_multiple_of(5);
                            (
                                channel,
                                favorite(
                                    &format!("f{index}"),
                                    if channel { "CHANNEL" } else { "DOCUMENT" },
                                    index as f64,
                                ),
                            )
                        })
                        .filter(|(channel, _)| match filter.get("entityTypes") {
                            Some(types) => {
                                types[0] == if *channel { "CHANNEL" } else { "DOCUMENT" }
                            }
                            None => true,
                        })
                        .map(|(_, favorite)| favorite)
                        .collect();
                    engine
                        .write_query(
                            None,
                            FAVORITES,
                            None,
                            variables,
                            &json!({"user": {"id": "viewer", "favorites": favorites}}),
                            None,
                        )
                        .await
                        .unwrap();
                }
                let mut cursors = Vec::new();
                for (op, variables) in variables.iter().enumerate() {
                    let update = engine
                        .watch_query(op as u64, FAVORITES, None, variables, &[], None)
                        .await
                        .unwrap();
                    cursors.push(revision(&update));
                }
                let mut samples = Vec::new();
                for sample in 0..SAMPLES {
                    let id = format!("new-{sample}");
                    let key = EntityKey::entity("GraphqlFavorite", &[&format!("document:{id}")]);
                    // The recipe approach patched every mounted list matching the favorite.
                    let link_patches: Vec<_> = if recipes {
                        variables
                            .iter()
                            .zip(&filters)
                            .filter(|(_, filter)| {
                                filter
                                    .get("entityTypes")
                                    .is_none_or(|types| types[0] == "DOCUMENT")
                            })
                            .map(|(variables, _)| OptimisticLinkPatch {
                                query: FAVORITES.into(),
                                record_root: None,
                                operation_name: None,
                                variables_json: canonical_json(&Json::Object(variables.clone())),
                                path: vec![
                                    LinkPathSegment::Field {
                                        field: "user".into(),
                                    },
                                    LinkPathSegment::Field {
                                        field: "favorites".into(),
                                    },
                                ],
                                operation: LinkOperation::PrependUnique {
                                    entity_key: key.clone(),
                                },
                            })
                            .collect()
                    } else {
                        Vec::new()
                    };
                    let data = json!({"setFavorite": {"favorite": favorite(&id, "DOCUMENT", count as f64)}});
                    let mutation_variables =
                        json!({"entity": {"type": "DOCUMENT", "id": id}, "favorite": true});
                    let start = Instant::now();
                    let (transaction, _) = engine
                        .begin_optimistic_write(
                            None,
                            BeginOptimisticWrite {
                                client_metadata: None,
                                identity_bindings: &[],
                                uuid: &format!("00000000-0000-4000-8000-{sample:012}"),
                                query: SET_FAVORITE,
                                operation_name: None,
                                variables: mutation_variables.as_object().unwrap(),
                                data: &data,
                                link_patches: &link_patches,
                                revalidations: &[],
                                created_at_ms: 0,
                            },
                        )
                        .await
                        .unwrap();
                    for (op, variables) in variables.iter().enumerate() {
                        let update = engine
                            .watch_query(
                                op as u64,
                                FAVORITES,
                                None,
                                variables,
                                &[],
                                Some(cursors[op]),
                            )
                            .await
                            .unwrap();
                        cursors[op] = revision(&update);
                    }
                    samples.push(start.elapsed());
                    // Roll back untimed, so every sample starts from the same lists.
                    let claimed = engine
                        .claim_next_mutation(MutationClaimRequest {
                            owner: "timing".into(),
                            now_ms: 0,
                            lease_expires_at_ms: 1,
                        })
                        .await
                        .unwrap()
                        .unwrap();
                    engine
                        .rollback_optimistic_write(
                            transaction,
                            MutationClaimToken {
                                owner: "timing".into(),
                                generation: claimed.lease_generation,
                            },
                        )
                        .await
                        .unwrap();
                    for (op, variables) in variables.iter().enumerate() {
                        let update = engine
                            .watch_query(
                                op as u64,
                                FAVORITES,
                                None,
                                variables,
                                &[],
                                Some(cursors[op]),
                            )
                            .await
                            .unwrap();
                        cursors[op] = revision(&update);
                    }
                }
                println!(
                    "| {lists} | {count} | {} | {:.1} µs |",
                    if recipes { "recipes" } else { "records" },
                    micros(samples)
                );
            });
        }
    }
}
