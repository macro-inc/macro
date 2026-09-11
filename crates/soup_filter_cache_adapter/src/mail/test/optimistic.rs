use super::*;

enum Removal {
    DraftAndSentPreviews,
    AllPreviews,
    InboxSort,
    SentSort,
}

async fn replacement_removals<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let mut base = seed();
    base["user"]["soup"]["items"] = json!([row(12)]);
    write(&mut engine, QUERY, &base).await;

    for removal in [
        Removal::DraftAndSentPreviews,
        Removal::AllPreviews,
        Removal::InboxSort,
        Removal::SentSort,
    ] {
        for view in ["ALL", "INBOX", "DRAFTS", "SENT"] {
            assert_eq!(all_keys(&mut engine, filters(), view).await.len(), 1);
        }
        let mut data = base.clone();
        let row = &mut data["user"]["soup"]["items"][0];
        match removal {
            Removal::DraftAndSentPreviews | Removal::AllPreviews => {
                row["mailDraftPreview"] = Value::Null;
                row["mailSentPreview"] = Value::Null;
                if matches!(removal, Removal::AllPreviews) {
                    row["mailAllPreview"] = Value::Null;
                }
            }
            Removal::InboxSort => row["latestInboundMessageTs"] = Value::Null,
            Removal::SentSort => {
                row["cacheProjection"] = json!(
                    encode_cache_projection_supplement(&SoupCacheProjectionSupplement::mail(
                        RecordKey::new(format!("{TYPE}:{}", id(12))).unwrap(),
                        MailCacheProjectionFacts::new(
                            Some(micros("2025-01-03T00:00:00.000003Z")),
                            None,
                            false,
                            false,
                        ),
                    ),)
                    .unwrap()
                );
            }
        }
        let vars = Map::new();
        let updates = projection_updates(engine.storage(), QUERY, None, &vars, &data)
            .await
            .unwrap();
        assert!(matches!(
            updates.as_slice(),
            [ProjectionMutation::Replace(_)]
        ));
        let (transaction, _) = engine
            .begin_optimistic_write_with_projections(
                None,
                BeginOptimisticWrite {
                    uuid: "00000000-0000-0000-0000-000000003000",
                    query: QUERY,
                    operation_name: None,
                    variables: &vars,
                    data: &data,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
                optimistic_updates(updates),
            )
            .await
            .unwrap();
        // The durable overlay must keep removals after reopening, not just in
        // the current engine's hot records.
        engine = Engine::new(engine.into_storage());
        for (view, expected) in [
            ("ALL", !matches!(removal, Removal::AllPreviews)),
            (
                "INBOX",
                matches!(removal, Removal::DraftAndSentPreviews | Removal::SentSort),
            ),
            (
                "DRAFTS",
                matches!(removal, Removal::InboxSort | Removal::SentSort),
            ),
            ("SENT", matches!(removal, Removal::InboxSort)),
        ] {
            assert_eq!(
                all_keys(&mut engine, filters(), view).await.len(),
                usize::from(expected),
                "only views using the removed preview or sort should lose the row: {view}",
            );
        }
        let claim = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "test".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        engine
            .rollback_optimistic_write(
                transaction,
                MutationClaimToken {
                    owner: "test".into(),
                    generation: claim.lease_generation,
                },
            )
            .await
            .unwrap();
    }
    for view in ["ALL", "INBOX", "DRAFTS", "SENT"] {
        assert_eq!(all_keys(&mut engine, filters(), view).await.len(), 1);
    }
}

async fn optional_sorts<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let mut data = seed();
    // Received mail has no outbound timestamp; sent-only and draft-only mail
    // have no inbound timestamp. All are complete, eligible Mail snapshots.
    data["user"]["soup"]["items"] = json!([row(6), row(8), row(3)]);
    for row in data["user"]["soup"]["items"].as_array_mut().unwrap() {
        if row["id"] != id(6) {
            row["latestInboundMessageTs"] = Value::Null;
        }
    }
    write(&mut engine, QUERY, &data).await;
    for row in data["user"]["soup"]["items"].as_array_mut().unwrap() {
        row["isRead"] = json!(true);
    }
    // The received thread remains in ALL/INBOX but its old draft membership
    // must be cleared even though the unrelated SENT sort is absent.
    data["user"]["soup"]["items"][0]["mailDraftPreview"] = Value::Null;
    let vars = Map::new();
    let updates = projection_updates(engine.storage(), QUERY, None, &vars, &data)
        .await
        .unwrap();
    assert_eq!(updates.len(), 3);
    assert!(
        updates
            .iter()
            .all(|update| matches!(update, ProjectionMutation::Replace(_)))
    );
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid: "00000000-0000-0000-0000-000000003001",
                query: QUERY,
                operation_name: None,
                variables: &vars,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 1,
            },
            optimistic_updates(updates),
        )
        .await
        .unwrap();
    engine = Engine::new(engine.into_storage());
    let mut read_filter = filters();
    read_filter["emailFilter"] = json!({"tree":{"literal":{"read":true}}});
    for (view, ids) in [
        ("ALL", vec![3, 6, 8]),
        ("INBOX", vec![6]),
        ("DRAFTS", vec![3]),
        ("SENT", vec![8]),
    ] {
        let mut keys = all_keys(&mut engine, read_filter.clone(), view).await;
        keys.sort();
        assert_eq!(
            keys,
            ids.into_iter()
                .map(|n| format!("{TYPE}:{}", id(n)))
                .collect::<Vec<_>>(),
            "{view}"
        );
    }
    let claim = engine
        .claim_next_mutation(MutationClaimRequest {
            owner: "test".into(),
            now_ms: 1,
            lease_expires_at_ms: 100,
        })
        .await
        .unwrap()
        .unwrap();
    engine
        .rollback_optimistic_write(
            transaction,
            MutationClaimToken {
                owner: "test".into(),
                generation: claim.lease_generation,
            },
        )
        .await
        .unwrap();
    assert!(all_keys(&mut engine, read_filter, "ALL").await.is_empty());
    assert_eq!(all_keys(&mut engine, filters(), "DRAFTS").await.len(), 2);
}

#[test]
fn full_optimism_does_not_create_completeness_without_authority() {
    use cache_core::predicate::{ProjectionMutationLayer, compose_effective_optimistic_projection};
    pollster::block_on(async {
        let mut data = seed();
        data["user"]["soup"]["items"] = json!([row(6)]);
        let updates = projection_updates(&InMemoryStorage::new(), QUERY, None, &Map::new(), &data)
            .await
            .unwrap();
        let mutations = optimistic_updates(updates);
        let key = RecordKey::new(format!("{TYPE}:{}", id(6))).unwrap();
        for authority in [
            None,
            Some(ProjectionState::Incomplete {
                record_key: key.clone(),
                profile: vocabulary::profile(),
                partition: vocabulary::partition(),
                kind: ProjectionIncompleteKind::Dirty,
            }),
        ] {
            let shadow = compose_effective_optimistic_projection(
                &key,
                authority.as_ref(),
                &[ProjectionMutationLayer {
                    owner: 1,
                    mutations: &mutations,
                }],
            )
            .unwrap()
            .unwrap();
            assert!(matches!(
                shadow.state,
                predicate_index::OptimisticProjectionState::Incomplete { .. }
            ));
        }
    });
}

#[test]
fn memory_optional_sorts_preserve_valid_mail_and_preview_removals() {
    pollster::block_on(optional_sorts(InMemoryStorage::new()));
}

#[test]
fn turso_optional_sorts_preserve_valid_mail_and_preview_removals() {
    pollster::block_on(optional_sorts(
        cache_turso::TursoStorage::open_in_memory("mail-optional-sorts").unwrap(),
    ));
}

#[test]
fn memory_optimistic_replacements_preserve_removals() {
    pollster::block_on(replacement_removals(InMemoryStorage::new()));
}

#[test]
fn turso_optimistic_replacements_preserve_removals() {
    pollster::block_on(replacement_removals(
        cache_turso::TursoStorage::open_in_memory("mail-optimistic-removals").unwrap(),
    ));
}
