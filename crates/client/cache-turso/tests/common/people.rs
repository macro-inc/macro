use cache_core::{
    engine::{Engine, HydrationScope},
    people::*,
    store::Storage,
    value::{CacheValue, EntityKey, Record},
};
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@example.com";
const WINNER: &str = "macro|winner@example.com";
const BLOCKED: &str = "macro|blocked@example.com";
const GHOST: &str = "macro|ghost@example.com";
const DUPLICATE: &str = "macro|duplicate@example.com";
const EXACT: &str = "macro|exact@example.com";
fn contact_key(user: &str) -> EntityKey<'static> {
    EntityKey::entity(
        "GraphqlContact",
        &[&Uuid::new_v5(
            &Uuid::new_v5(&Uuid::NAMESPACE_OID, VIEWER.as_bytes()),
            user.as_bytes(),
        )
        .to_string()],
    )
}
fn contact(user: &str, id: &str) -> Record {
    Record {
        fields: [
            (
                "__typename".into(),
                CacheValue::String("GraphqlContact".into()),
            ),
            ("id".into(), CacheValue::String(id.into())),
            ("userId".into(), CacheValue::String(user.into())),
            ("name".into(), CacheValue::String("Alpha".into())),
            (
                "email".into(),
                CacheValue::String(user.strip_prefix("macro|").unwrap().into()),
            ),
        ]
        .into(),
    }
}

/// Ordinary rows precede the real winner in storage order. Page fixtures never
/// hold the whole corpus in the test either.
pub async fn seed<S: Storage>(storage: &mut S, count: usize) {
    for start in (0..count).step_by(500) {
        storage
            .put_batch(
                (start..(start + 500).min(count))
                    .map(|index| {
                        let id = format!("00000000-0000-7000-8000-{index:012}");
                        let user = format!("macro|p{index:06}@example.com");
                        (
                            EntityKey::entity("GraphqlContact", &[&id]),
                            contact(&user, &id),
                        )
                    })
                    .collect(),
            )
            .await
            .unwrap();
    }
    storage
        .put_batch(
            [WINNER, BLOCKED, DUPLICATE, EXACT]
                .into_iter()
                .map(|user| {
                    let key = contact_key(user);
                    let mut record = contact(user, key.id().unwrap());
                    if user == EXACT {
                        record
                            .fields
                            .insert("name".into(), CacheValue::String("Al".into()));
                    }
                    (key, record)
                })
                .collect(),
        )
        .await
        .unwrap();
}

pub async fn assert_policy<S: Storage>(storage: S) -> S {
    let mut engine = Engine::new(storage);
    let scope = HydrationScope {
        identity: VIEWER.into(),
        storage_generation: engine.current_storage_generation().await.unwrap(),
    };
    let mut request = PeopleSearch {
        scope: scope.clone(),
        mode: PeopleMode::Command,
        query: "alpha".into(),
        excluded: vec![],
        sender_domain: None,
        limit: 1,
        now_ms: 2_000,
    };
    assert!(matches!(
        engine.search_people(&request).await.unwrap(),
        PeopleSearchResult::ContextPending
    ));
    let epoch = Uuid::now_v7();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Begin {
                previous_epoch: None,
            },
        })
        .await
        .unwrap();
    let conversation = Uuid::now_v7();
    let patches = [WINNER, BLOCKED, GHOST, DUPLICATE]
        .into_iter()
        .map(|user| PersonFactPatch {
            user_id: user.to_owned().try_into().unwrap(),
            facts: PersonFacts {
                last_interaction_ms: Some(2_000),
                direct_message: Some(DirectMessageFacts {
                    id: if user == WINNER || user == DUPLICATE {
                        conversation
                    } else {
                        Uuid::now_v7()
                    },
                    name: "Alpha".into(),
                    timestamp_ms: if user == DUPLICATE { 1_000 } else { 2_000 },
                }),
                secondary_inbox: user == BLOCKED,
            },
        })
        .collect();
    let update = ContextUpdate {
        scope: scope.clone(),
        epoch,
        action: ContextAction::Patch { updates: patches },
    };
    assert!(
        engine
            .update_people_context(&update)
            .await
            .unwrap()
            .revision_advanced
    );
    assert!(
        !engine
            .update_people_context(&update)
            .await
            .unwrap()
            .revision_advanced
    );
    assert!(matches!(
        engine.search_people(&request).await.unwrap(),
        PeopleSearchResult::ContextPending
    ));
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Commit,
        })
        .await
        .unwrap();
    let PeopleSearchResult::Page { people, truncated } =
        engine.search_people(&request).await.unwrap()
    else {
        panic!("published context must be ready")
    };
    assert!(truncated);
    assert_eq!(people.len(), 1);
    assert_eq!(
        people[0].user_id.as_ref(),
        WINNER,
        "DM ranking and exclusions must happen before LIMIT"
    );
    assert!(people[0].score > 5.0);
    request.limit = 2;
    let PeopleSearchResult::Page { people, .. } = engine.search_people(&request).await.unwrap()
    else {
        panic!("ready")
    };
    assert_eq!(people.len(), 2);
    assert!(
        people
            .iter()
            .all(|person| person.user_id.as_ref() != DUPLICATE),
        "a duplicate conversation must not consume the second result slot"
    );
    request.limit = 1;
    request.query = "al".into();
    let PeopleSearchResult::Page { people, .. } = engine.search_people(&request).await.unwrap()
    else {
        panic!("ready")
    };
    assert_eq!(
        people[0].user_id.as_ref(),
        EXACT,
        "an exact label precedes even a boosted DM prefix"
    );
    request.limit = MAX_PEOPLE_BATCH + 1;
    assert!(engine.search_people(&request).await.is_err());
    request.limit = 1;
    request.query = "alpha".into();
    let ghost = engine
        .storage()
        .get_batch(&[contact_key(GHOST)])
        .await
        .unwrap()
        .remove(0)
        .unwrap();
    assert!(
        !ghost.fields.contains_key("name")
            && !ghost.fields.contains_key("id")
            && !ghost.fields.contains_key("email")
    );
    request.excluded = vec![WINNER.to_owned().try_into().unwrap()];
    let PeopleSearchResult::Page { people, .. } = engine.search_people(&request).await.unwrap()
    else {
        panic!("ready")
    };
    assert_ne!(people[0].user_id.as_ref(), WINNER);
    assert_ne!(people[0].user_id.as_ref(), BLOCKED);
    assert_ne!(
        people[0].user_id.as_ref(),
        GHOST,
        "local facts are not membership"
    );
    request.mode = PeopleMode::Recipient;
    request.query = "p000001@example.com".into();
    let PeopleSearchResult::Page { people, .. } = engine.search_people(&request).await.unwrap()
    else {
        panic!("ready")
    };
    assert_eq!(people[0].user_id.as_ref(), "macro|p000001@example.com");
    assert_eq!(people[0].match_rank, 3);
    // A new full snapshot expires facts for relationships no longer present.
    let replacement = Uuid::now_v7();
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch: replacement,
            action: ContextAction::Begin {
                previous_epoch: Some(epoch),
            },
        })
        .await
        .unwrap();
    assert!(engine.update_people_context(&update).await.is_err());
    assert!(
        engine
            .update_people_context(&ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Begin {
                    previous_epoch: None
                }
            })
            .await
            .is_err()
    );
    engine
        .update_people_context(&ContextUpdate {
            scope: scope.clone(),
            epoch: replacement,
            action: ContextAction::Commit,
        })
        .await
        .unwrap();
    request.mode = PeopleMode::Command;
    request.query = "alpha".into();
    request.excluded.clear();
    let PeopleSearchResult::Page { people, .. } = engine.search_people(&request).await.unwrap()
    else {
        panic!("ready")
    };
    assert_eq!(
        people[0].user_id.as_ref(),
        BLOCKED,
        "old secondary flags and DM boosts must expire"
    );
    let mut reopened = Engine::new(engine.into_storage());
    assert!(matches!(
        reopened.search_people(&request).await.unwrap(),
        PeopleSearchResult::Page { .. }
    ));
    reopened.clear().await.unwrap();
    assert!(reopened.update_people_context(&update).await.is_err());
    assert!(reopened.search_people(&request).await.is_err());
    reopened.into_storage()
}
