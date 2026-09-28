use super::*;

const SAVE: &str = r#"mutation SaveEmailDraft($input: SaveEmailDraftInput!) {
    saveEmailDraft(input: $input) { thread {
        __typename id linkId ownerId inboxVisible isRead isSignal cacheProjection latestInboundMessageTs updatedAt
        mailAllPreview { id } mailDraftPreview { id } mailSentPreview { id }
        properties { __typename propertyDefinitionId }
        mailDraftState {
            baseline { messageCount latestNonSpamMessageTs latestOutboundMessageTs hasCalendarAttachment }
            drafts { id macroDraft facts { messageCount latestNonSpamMessageTs latestOutboundMessageTs hasCalendarAttachment } }
        }
    } }
}"#;

async fn cached_keys<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    filter: Value,
    view: &str,
) -> Vec<String> {
    match page_current(
        engine,
        "draft-generation",
        filter,
        "UPDATED_AT",
        "DESC",
        20,
        PageRequest {
            view: view.into(),
            cursor: None,
        },
    )
    .await
    .unwrap()
    {
        PageResult::MailPage { keys, .. } => keys,
        _ => panic!("complete Mail page expected"),
    }
}

async fn offline_lifecycle<S: PredicateIndexStorage>(storage: S) {
    let mut engine = Engine::new(storage);
    let mut catalog = seed();
    catalog["user"]["soup"]["items"] = json!([]);
    write(&mut engine, QUERY, &catalog).await;
    let mut thread = row(81);
    thread["ownerId"] = json!(VIEWER);
    thread["linkId"] = json!(id(1000));
    thread["cacheProjection"] = Value::Null;
    thread["inboxVisible"] = json!(true);
    thread["isSignal"] = json!(false);
    thread["mailAllPreview"] = json!({"id":id(10081)});
    thread["mailDraftPreview"] = json!({"id":id(10081)});
    thread["mailSentPreview"] = Value::Null;
    thread["properties"] = json!([]);
    let empty = json!({"messageCount":0,"latestNonSpamMessageTs":null,"latestOutboundMessageTs":null,"hasCalendarAttachment":false});
    let facts = json!({"messageCount":1,"latestNonSpamMessageTs":"2026-09-22T10:00:00Z","latestOutboundMessageTs":null,"hasCalendarAttachment":false});
    thread["mailDraftState"] =
        json!({"baseline":empty,"drafts":[{"id":id(10081),"macroDraft":true,"facts":facts}]});
    let data = json!({"saveEmailDraft":{"thread":thread}});
    let variables = json!({"input":{"draftId":id(10081),"threadDbId":id(81),"subject":"Offline"}})
        .as_object()
        .unwrap()
        .clone();
    let mut projections = optimistic_updates(
        projection_updates(
            engine.storage(),
            SAVE,
            Some("SaveEmailDraft"),
            &variables,
            &data,
        )
        .await
        .unwrap(),
    );
    projections.extend(
        draft_optimistic_updates(
            engine.storage(),
            SAVE,
            Some("SaveEmailDraft"),
            &variables,
            &data,
        )
        .await
        .unwrap(),
    );
    let projections = crate::properties::augment_optimistic(
        engine.storage(),
        SAVE,
        Some("SaveEmailDraft"),
        &variables,
        &data,
        projections,
    )
    .await
    .unwrap();
    let (transaction, _) = engine
        .begin_optimistic_write_with_projections(
            None,
            BeginOptimisticWrite {
                uuid: "00000000-0000-4000-8000-000000000081",
                query: SAVE,
                operation_name: Some("SaveEmailDraft"),
                variables: &variables,
                data: &data,
                link_patches: &[],
                revalidations: &[],
                identity_bindings: &[],
                created_at_ms: 0,
            },
            projections,
        )
        .await
        .unwrap();
    engine = Engine::new(engine.into_storage());
    for view in ["ALL", "INBOX", "DRAFTS"] {
        assert_eq!(
            cached_keys(&mut engine, filters(), view).await,
            vec![format!("{TYPE}:{}", id(81))]
        );
    }
    assert!(cached_keys(&mut engine, filters(), "SENT").await.is_empty());
    for (literal, expected) in [
        ("importance", false),
        ("calendarOnly", false),
        ("shared", false),
    ] {
        let mut f = filters();
        f["emailFilter"] = json!({"tree":{"literal":{literal: if literal == "shared" { json!("ONLY") } else { json!(true) }}}});
        let keys = cached_keys(&mut engine, f, "ALL").await;
        assert_eq!(!keys.is_empty(), expected, "{literal}");
    }
    let mut noise = filters();
    noise["emailFilter"] = json!({"tree":{"literal":{"importance":false}}});
    assert_eq!(cached_keys(&mut engine, noise, "INBOX").await.len(), 1);
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
    assert!(
        cached_keys(&mut engine, filters(), "DRAFTS")
            .await
            .is_empty()
    );
}

#[test]
fn fresh_draft_reaches_every_applicable_mail_view_after_restart() {
    pollster::block_on(offline_lifecycle(InMemoryStorage::new()));
}

#[test]
fn fresh_draft_reaches_mail_with_turso_durable_shadows() {
    pollster::block_on(offline_lifecycle(
        cache_turso::TursoStorage::open_in_memory("mail-draft-create").unwrap(),
    ));
}

#[test]
fn absent_thread_revalidation_revokes_stale_mail_membership() {
    pollster::block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write(&mut engine, QUERY, &seed()).await;
        let before = all_keys(&mut engine, filters(), "ALL").await;
        assert!(!before.is_empty());
        let thread_id = before[0].strip_prefix("GraphqlSoupEmailThread:").unwrap();
        let query = "query EmailThreadPage($threadId: ID!) { user { id emailThread(input: {threadId: $threadId}) { id } } }";
        let variables = json!({"threadId":thread_id}).as_object().unwrap().clone();
        let data = json!({"user":{"id":VIEWER,"emailThread":null}});
        let projections = projection_updates(
            engine.storage(),
            query,
            Some("EmailThreadPage"),
            &variables,
            &data,
        )
        .await
        .unwrap();
        engine
            .write_query_with_registration_and_projections(
                None,
                None,
                cache_core::engine::NetworkWrite {
                    query,
                    operation_name: Some("EmailThreadPage"),
                    variables: &variables,
                    data: &data,
                    identity: None,
                },
                projections,
            )
            .await
            .unwrap();
        let after = all_keys(&mut engine, filters(), "ALL").await;
        assert!(!after.contains(&before[0]));
        assert_eq!(after.len(), before.len() - 1);
    });
}
