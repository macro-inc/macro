use super::*;
use cache_core::store::Storage;
use cache_core::value::CacheValue;
use serde_json::json;

async fn bind(handle: &EngineHandle) {
    handle
        .write(WriteRequest {
            origin_op_id: None,
            registration: None,
            query: "{ user { id } }".into(),
            operation_name: None,
            variables: Variables::new(),
            data: json!({"user":{"id":"viewer"}}),
            identity: Some("viewer".into()),
            channel_commit: None,
        })
        .await
        .unwrap();
}

#[test]
fn native_implicit_retirement_notifies_other_windows_before_returning_content() {
    block_on(async {
        let (first, first_events) = std::sync::mpsc::channel();
        let (second, second_events) = std::sync::mpsc::channel();
        let handle = spawn_handle();
        bind(&handle).await;
        let handle = handle.with_authority_listener("profile".into(), move |authority| {
            first.send(authority.clone()).unwrap();
            second.send(authority.clone()).unwrap();
        });
        let before = handle.current_authority("profile").await.unwrap();
        let old = handle.clone().with_generation(Some(before.generation));
        {
            let mut state = handle.inner.lock().await;
            state
                .engine
                .begin_authority_transition(
                    "profile",
                    before.generation,
                    "team:denied".into(),
                    true,
                )
                .await
                .unwrap();
        }
        handle
            .read(
                None,
                "{ user { id } }".into(),
                None,
                Variables::new(),
                vec![],
            )
            .await
            .unwrap();
        let recovered = first_events.try_recv().unwrap();
        assert_eq!(second_events.try_recv().unwrap(), recovered);
        assert!(recovered.ready);
        assert_eq!(recovered.policy.as_deref(), Some("team:denied"));
        assert_ne!(recovered.generation, before.generation);
        assert!(
            old.write(WriteRequest {
                origin_op_id: None,
                registration: None,
                query: "{ user { id } }".into(),
                operation_name: None,
                variables: Variables::new(),
                data: json!({"user": {"id": "viewer"}}),
                identity: Some("viewer".into()),
                channel_commit: None,
            })
            .await
            .is_err()
        );
        handle.current_authority("profile").await.unwrap();
        assert!(first_events.try_recv().is_err());
        assert!(second_events.try_recv().is_err());
    });
}

#[test]
fn native_account_replacement_still_notifies_under_the_lock_and_rejects_old_writes() {
    block_on(async {
        let handle = spawn_handle();
        bind(&handle).await;
        let before = handle.current_authority("profile").await.unwrap();
        let competing = handle.clone();
        let (events, received) = std::sync::mpsc::channel();
        let handle = handle
            .with_generation(Some(before.generation))
            .with_authority_listener("profile".into(), move |authority| {
                let mut next = std::pin::pin!(competing.current_revision());
                let mut context = std::task::Context::from_waker(std::task::Waker::noop());
                assert!(std::future::Future::poll(next.as_mut(), &mut context).is_pending());
                events.send(authority.clone()).unwrap();
            });
        handle
            .write(WriteRequest {
                origin_op_id: None,
                registration: None,
                query: "{ user { id } }".into(),
                operation_name: None,
                variables: Variables::new(),
                data: json!({"user":{"id":"replacement"}}),
                identity: Some("replacement".into()),
                channel_commit: None,
            })
            .await
            .unwrap();
        let event = received.try_recv().unwrap();
        assert_ne!(event.generation, before.generation);
        assert_eq!(event.account.as_deref(), Some("replacement"));
        assert!(received.try_recv().is_err());
        assert!(
            handle
                .write(WriteRequest {
                    origin_op_id: None,
                    registration: None,
                    query: "{ user { id } }".into(),
                    operation_name: None,
                    variables: Variables::new(),
                    data: json!({"user":{"id":"viewer"}}),
                    identity: Some("viewer".into()),
                    channel_commit: None,
                })
                .await
                .is_err()
        );
        assert_eq!(handle.current_authority("profile").await.unwrap(), event);
    });
}

#[test]
fn native_authority_events_cannot_be_overtaken_by_another_transition() {
    block_on(async {
        let handle = spawn_handle();
        bind(&handle).await;
        let before = handle.current_authority("profile").await.unwrap();
        let competing = handle.clone();
        let (events, received) = std::sync::mpsc::channel();
        let handle = handle.with_authority_listener("profile".into(), move |authority| {
            // Another window cannot acquire the owner until this event is sent.
            let mut next = std::pin::pin!(competing.current_revision());
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            assert!(std::future::Future::poll(next.as_mut(), &mut context).is_pending());
            events.send(authority.clone()).unwrap();
        });
        let mut previous = before.generation;
        for policy in ["team:denied", "team:allowed", "team:denied"] {
            let result = handle
                .transition_authority("profile", previous, policy.into())
                .await
                .unwrap();
            let event = received.try_recv().unwrap();
            assert_eq!(event, result.authority);
            assert_eq!(event.policy.as_deref(), Some(policy));
            assert_ne!(event.generation, previous);
            previous = event.generation;
        }
        assert!(received.try_recv().is_err());
    });
}

#[test]
fn native_generation_boundary_rejects_old_writes_but_settles_authored_commands() {
    block_on(async {
        let handle = spawn_handle();
        bind(&handle).await;
        let before = handle.current_authority("profile").await.unwrap();
        let allowed = handle
            .transition_authority("profile", before.generation, "team:allowed".into())
            .await
            .unwrap()
            .authority;
        let old = handle.clone().with_generation(Some(allowed.generation));
        let denied = handle
            .transition_authority("profile", allowed.generation, "team:denied".into())
            .await
            .unwrap()
            .authority;
        assert!(
            old.read(
                None,
                "{ user { id } }".into(),
                None,
                Variables::new(),
                vec![]
            )
            .await
            .is_ok()
        );
        let query = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id emailName: name } } }";
        let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"server-thread","emailName":"retired subject"}}});
        let variables = json!({"input":{"bodyText":"authored reply","threadId":"local-thread"}})
            .as_object()
            .unwrap()
            .clone();
        for (index, admitted) in [old].into_iter().enumerate() {
            assert!(
                admitted
                    .read(
                        None,
                        QUERY.into(),
                        Some("Soup".into()),
                        super::variables(),
                        vec![]
                    )
                    .await
                    .is_ok()
            );
            assert!(
                admitted
                    .write(WriteRequest {
                        origin_op_id: None,
                        registration: None,
                        query: QUERY.into(),
                        operation_name: Some("Soup".into()),
                        variables: super::variables(),
                        data: soup_data(false),
                        identity: Some("viewer".into()),
                        channel_commit: None,
                    })
                    .await
                    .is_err()
            );
            let enqueued = admitted
                .enqueue_optimistic_mutation(
                    None,
                    uuid::Uuid::now_v7().to_string(),
                    query.into(),
                    Some("Save".into()),
                    variables.clone(),
                    data.clone(),
                    vec![],
                    vec![],
                    vec![],
                    1,
                    format!("writer-{index}"),
                    2,
                    100,
                    None,
                    vec![],
                )
                .await
                .unwrap();
            let wire = serde_json::to_value(enqueued).unwrap();
            assert_eq!(wire["initialClaim"]["kind"], "claimed");
            admitted
                .commit_optimistic_write(
                    wire["transactionId"].as_str().unwrap().into(),
                    format!("writer-{index}"),
                    wire["initialClaim"]["mutation"]["leaseGeneration"]
                        .as_str()
                        .unwrap()
                        .into(),
                    query.into(),
                    Some("Save".into()),
                    variables.clone(),
                    data.clone(),
                )
                .await
                .unwrap();
        }
        let state = handle.inner.lock().await;
        assert!(
            state
                .engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let records = state
            .engine
            .storage()
            .get_batch(&[EntityKey("GraphqlSoupEmailThread:server-thread".into())])
            .await
            .unwrap();
        assert!(
            records[0]
                .as_ref()
                .is_none_or(|row| !row.fields.contains_key("name"))
        );
        drop(state);
        let current = handle.clone().with_generation(Some(denied.generation));
        assert!(
            current
                .read(
                    None,
                    "{ user { id } }".into(),
                    None,
                    Variables::new(),
                    vec![]
                )
                .await
                .is_ok()
        );
        current
            .write(WriteRequest {
                origin_op_id: None,
                registration: None,
                query: query.into(),
                operation_name: Some("Save".into()),
                variables,
                data,
                identity: None,
                channel_commit: None,
            })
            .await
            .unwrap();
        let state = handle.inner.lock().await;
        let records = state
            .engine
            .storage()
            .get_batch(&[EntityKey("GraphqlSoupEmailThread:server-thread".into())])
            .await
            .unwrap();
        assert_eq!(
            records[0].as_ref().unwrap().fields.get("name"),
            Some(&CacheValue::String("retired subject".into()))
        );
    });
}

#[test]
fn native_authoritative_mutations_keep_unrelated_property_ownership_without_parent_reads() {
    block_on(async {
        let handle = spawn_handle();
        bind(&handle).await;
        let before = handle.current_authority("profile").await.unwrap();
        let allowed = handle
            .transition_authority("profile", before.generation, "team:allowed".into())
            .await
            .unwrap()
            .authority;
        let writer = handle.clone().with_generation(Some(allowed.generation));
        for (id, kind) in [
            ("doc-property", "DOCUMENT"),
            ("calendar-property", "CALENDAR_EVENT"),
            ("crm-property", "COMPANY"),
        ] {
            writer.write(WriteRequest { origin_op_id: None, registration: None,
                query: "mutation Set($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { __typename id propertyDefinitionId } }".into(), operation_name: Some("Set".into()),
                variables: json!({"input":{"entityId":"owner","entityType":kind}}).as_object().unwrap().clone(),
                data: json!({"setEntityProperty":{"__typename":"GraphqlProperty","id":id,"propertyDefinitionId":"definition"}}), identity: None, channel_commit: None }).await.unwrap();
        }
        handle
            .transition_authority("profile", allowed.generation, "team:denied".into())
            .await
            .unwrap();
        let state = handle.inner.lock().await;
        let rows = state
            .engine
            .storage()
            .get_batch(&[
                EntityKey("GraphqlProperty:doc-property".into()),
                EntityKey("GraphqlProperty:calendar-property".into()),
                EntityKey("GraphqlProperty:crm-property".into()),
            ])
            .await
            .unwrap();
        assert!(rows[0].is_some());
        assert!(rows[1].is_some());
        assert!(rows[2].is_none());
    });
}

#[test]
fn native_first_non_denied_proof_preserves_offline_mail() {
    block_on(async {
        for policy in ["team:allowed", "none"] {
            let handle = spawn_handle();
            bind(&handle).await;
            let query = "{ user { id emailThread(id: \"thread\") { __typename id name } } }";
            let data = json!({"user":{"id":"viewer","emailThread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"offline subject"}}});
            handle
                .write(WriteRequest {
                    origin_op_id: None,
                    registration: None,
                    query: query.into(),
                    operation_name: None,
                    variables: Variables::new(),
                    data: data.clone(),
                    identity: Some("viewer".into()),
                    channel_commit: None,
                })
                .await
                .unwrap();
            let before = handle.current_authority("profile").await.unwrap();
            let allowed = handle
                .transition_authority("profile", before.generation, policy.into())
                .await
                .unwrap();
            assert_eq!(allowed.authority.generation, before.generation);
            let admitted = handle.with_generation(Some(allowed.authority.generation));
            assert!(
                matches!(admitted.read(None, query.into(), None, Variables::new(), vec![]).await.unwrap(), ReadResultWire::Hit { data: cached } if cached == data)
            );
        }
    });
}

/// An abandoned read skips reading, not its turn: an interrupted retirement
/// it finds is finished and announced before anything queued behind it runs.
#[test]
fn an_abandoned_read_still_finishes_an_interrupted_retirement() {
    let (sender, events) = std::sync::mpsc::channel();
    let handle = spawn_handle();
    block_on(bind(&handle));
    let handle = handle.with_authority_listener("profile".into(), move |authority| {
        sender.send(authority.clone()).unwrap();
    });
    block_on(async {
        let before = handle.current_authority("profile").await.unwrap();
        let mut state = handle.inner.lock().await;
        state
            .engine
            .begin_authority_transition("profile", before.generation, "team:denied".into(), true)
            .await
            .unwrap();
    });
    let reader = handle.clone().abandonable(Some("read-1".to_owned()));
    abandon_queued(
        &handle,
        "read-1",
        reader.read(
            Some("client:1".to_owned()),
            "{ user { id } }".into(),
            None,
            Variables::new(),
            vec![],
        ),
    );
    let recovered = events.try_recv().unwrap();
    assert!(recovered.ready);
    assert_eq!(recovered.policy.as_deref(), Some("team:denied"));
}
