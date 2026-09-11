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
        assert!(all_keys(&mut engine, filters(), "DRAFTS").await.is_empty());
        assert!(all_keys(&mut engine, filters(), "SENT").await.is_empty());
        assert_eq!(
            all_keys(&mut engine, filters(), "ALL").await.len(),
            usize::from(matches!(removal, Removal::DraftAndSentPreviews)),
        );
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
