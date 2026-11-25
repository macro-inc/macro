//! A queue salvaged from a wiped cache into the next one, then the schema
//! adoption that opens it: the next cache judges the queue's overlays by the
//! schema they were made under, as the wiped one would have.
use super::schema_store::{ADDED, OLD, RETYPED, adopt, pending, sources, types};
use super::*;
use cache_core::engine::{IDENTITY_META_KEY, IDENTITY_VALUE_FIELD};
use cache_core::queue::{MutationRequest, NewQueuedMutation};
use cache_core::schema_change::{ProjectionInputs, ResetReason, Tier, is_retired};
use cache_core::value::CacheValue;

const SCOPE: &str = "schema-salvage";

fn rename() -> NewQueuedMutation {
    pending(
        "Rename",
        "mutation Rename { rename(id: \"1\") { id value } }",
        serde_json::json!({ "rename": { "id": "1", "value": "renamed" } }),
        &["Thing:1"],
    )
}

fn edit() -> NewQueuedMutation {
    pending(
        "Edit",
        "mutation Edit { edit(id: \"1\") { id value } }",
        serde_json::json!({ "edit": { "id": "1", "value": "edited" } }),
        &["Note:1"],
    )
}

/// A cache that stores `sdl`, or no schema at all, and queues `writes` under
/// the account it stores.
async fn queuing(sdl: Option<&str>, writes: Vec<NewQueuedMutation>) -> TursoStorage {
    let mut storage = TursoStorage::open_in_memory(SCOPE).unwrap();
    if let Some(sdl) = sdl {
        assert_eq!(adopt(&storage, sdl, &ProjectionInputs::none()).change, None);
    }
    let mut account = Record::default();
    account.fields.insert(
        IDENTITY_VALUE_FIELD.into(),
        CacheValue::String("identity".into()),
    );
    storage
        .put_batch(vec![
            (key(IDENTITY_META_KEY), account),
            (key("Thing:1"), record("thing")),
            (key("Note:1"), record("note")),
        ])
        .await
        .unwrap();
    for write in writes {
        storage.enqueue_mutation(write).await.unwrap();
    }
    storage
}

/// What a wipe of `storage` carries, joined with `pending` as a wipe joins
/// the copy of an earlier one, through the side file.
fn salvaged(storage: &TursoStorage, pending: Option<SalvagedQueue>) -> SalvagedQueue {
    let read = storage.salvage_queue(SCOPE, pending, 0);
    SalvageFile::decode(&read.queue.unwrap().to_frame())
        .into_queue()
        .unwrap()
}

/// The database a wipe opens next, holding `queue`.
fn next_holding(queue: &SalvagedQueue) -> TursoStorage {
    let mut next = TursoStorage::open_in_memory(SCOPE).unwrap();
    assert_eq!(next.import_queue(queue, 0).unwrap().kept, queue.len());
    next
}

async fn requests(storage: &mut TursoStorage) -> Vec<MutationRequest> {
    storage
        .load_mutation_queue()
        .await
        .unwrap()
        .into_iter()
        .map(|queued| queued.mutation.request)
        .collect()
}

#[test]
fn a_salvaged_queue_meets_a_schema_as_its_own_cache_would_have() {
    block_on(async {
        for (incoming, tier, retired) in [
            (OLD, None, 0),
            (ADDED, Some(Tier::Compatible), 0),
            // `Rename` returns a `Thing`, `Edit` a `Note`.
            (RETYPED, types(&["Thing"], false), 1),
        ] {
            let mut wiped = queuing(Some(OLD), vec![rename(), edit()]).await;
            let mut next = next_holding(&salvaged(&wiped, None));

            let moved = adopt(&next, incoming, &ProjectionInputs::none());
            let stayed = adopt(&wiped, incoming, &ProjectionInputs::none());
            for adoption in [&moved, &stayed] {
                assert_eq!(adoption.change, tier, "{incoming}");
                assert_eq!(adoption.retired_overlays, retired, "{incoming}");
            }
            assert_eq!(moved.schema.hash(), stayed.schema.hash());
            assert_eq!(sources(&mut next).await, sources(&mut wiped).await);
            assert_eq!(requests(&mut next).await, requests(&mut wiped).await);
            assert_eq!(
                adopt(&next, incoming, &ProjectionInputs::none()).change,
                None,
                "{incoming}: the next open sorts nothing"
            );
        }
    });
}

#[test]
fn a_queue_from_a_cache_that_stored_no_schema_meets_the_guess_its_cache_would_have() {
    block_on(async {
        let mut wiped = queuing(None, vec![rename(), edit()]).await;
        let mut next = next_holding(&salvaged(&wiped, None));
        let moved = adopt(&next, OLD, &ProjectionInputs::none());
        let stayed = adopt(&wiped, OLD, &ProjectionInputs::none());
        assert_eq!(moved.change, stayed.change);
        assert_eq!(moved.retired_overlays, stayed.retired_overlays);
        assert_eq!(sources(&mut next).await, sources(&mut wiped).await);
    });
}

#[test]
fn a_queue_joined_from_caches_of_two_schemas_resets_the_next_one_and_keeps_every_write() {
    block_on(async {
        let older = queuing(Some(OLD), vec![rename()]).await;
        let newer = queuing(Some(ADDED), vec![edit()]).await;
        let joined = salvaged(&newer, Some(salvaged(&older, None)));
        assert_eq!(joined.len(), 2);
        let mut next = next_holding(&joined);

        let adoption = adopt(&next, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(adoption.retired_overlays, 2);
        let names = requests(&mut next)
            .await
            .into_iter()
            .map(|request| request.operation_name.unwrap())
            .collect::<Vec<_>>();
        assert_eq!(names, ["Edit", "Rename"]);
        assert!(sources(&mut next).await.iter().all(is_retired));

        // A join that adds no older write, which the newer cache queues
        // under another ID, keeps the newer schema.
        let write = rename();
        let older = queuing(Some(OLD), vec![write.clone()]).await;
        let newer = queuing(Some(ADDED), vec![edit(), write]).await;
        let joined = salvaged(&newer, Some(salvaged(&older, None)));
        assert_eq!(joined.len(), 2);
        let next = next_holding(&joined);
        let adoption = adopt(&next, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, None);
        assert_eq!(adoption.retired_overlays, 0);
    });
}

#[test]
fn a_queue_imported_into_a_cache_of_another_schema_resets_it_and_keeps_every_write() {
    block_on(async {
        let wiped = queuing(Some(OLD), vec![rename(), edit()]).await;
        let queue = salvaged(&wiped, None);

        // The next database was opened, under a later build, before the
        // import that a closed engine left to its next open.
        let mut next = queuing(Some(ADDED), Vec::new()).await;
        next.import_queue(&queue, 0).unwrap();
        let adoption = adopt(&next, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(adoption.retired_overlays, 2);
        assert_eq!(requests(&mut next).await.len(), 2);

        // One of the same schema takes it as its own.
        let mut next = queuing(Some(OLD), Vec::new()).await;
        next.import_queue(&queue, 0).unwrap();
        let adoption = adopt(&next, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, None);
        assert!(!sources(&mut next).await.iter().any(is_retired));
    });
}

#[test]
fn a_copy_whose_every_write_the_cache_already_queues_leaves_its_schema_alone() {
    block_on(async {
        let write = rename();
        let older = queuing(Some(OLD), vec![write.clone()]).await;
        // The write, queued again under another ID by a build of another schema.
        let mut newer = queuing(Some(ADDED), vec![edit(), write]).await;
        let imported = newer.import_queue(&salvaged(&older, None), 0).unwrap();
        assert_eq!(imported.kept, 0);
        let adoption = adopt(&newer, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, None);
        assert_eq!(adoption.retired_overlays, 0);
        assert!(!sources(&mut newer).await.iter().any(is_retired));
    });
}

#[test]
fn a_queue_imported_into_a_cache_that_held_records_under_no_schema_resets_it() {
    block_on(async {
        let queue = salvaged(&queuing(Some(OLD), vec![rename(), edit()]).await, None);
        let mut next = queuing(None, Vec::new()).await;
        assert_eq!(next.import_queue(&queue, 0).unwrap().kept, 2);
        let adoption = adopt(&next, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(requests(&mut next).await.len(), 2);
    });
}

#[test]
fn a_queue_from_a_cache_whose_schema_cannot_be_read_resets_the_next_one() {
    block_on(async {
        for damage in [
            "UPDATE cache_schema SET hash = 'other', incoming_hash = 'other', artifact = x'00'",
            // A value of a type no build writes.
            "UPDATE cache_schema SET artifact = 'schema'",
        ] {
            let wiped = queuing(Some(OLD), vec![rename(), edit()]).await;
            raw_execute(&wiped, damage, vec![]);
            let mut next = next_holding(&salvaged(&wiped, None));
            let adoption = adopt(&next, OLD, &ProjectionInputs::none());
            assert_eq!(
                adoption.change,
                Some(Tier::Reset(ResetReason::Unreadable)),
                "{damage}"
            );
            assert_eq!(requests(&mut next).await.len(), 2, "{damage}");
        }
    });
}
