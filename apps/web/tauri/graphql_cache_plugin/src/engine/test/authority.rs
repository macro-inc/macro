use super::*;
use cache_core::engine::authority::AuthorityAdmission;
use cache_core::store::Storage;
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
        })
        .await
        .unwrap();
}

#[test]
fn native_permission_boundary_rejects_old_reads_and_writes_but_settles_authored_commands() {
    block_on(async {
        let handle = spawn_handle();
        bind(&handle).await;
        let before = handle.current_authority("profile").await.unwrap();
        let allowed = handle
            .transition_authority("profile", before.generation, "team:allowed".into())
            .await
            .unwrap()
            .authority;
        let old = handle
            .clone()
            .with_authority(Some(AuthorityAdmission::protected(Some(
                allowed.generation,
            ))));
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
            .is_err()
        );
        let query = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id emailName: name } } }";
        let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"server-thread","emailName":"retired subject"}}});
        let variables = json!({"input":{"bodyText":"authored reply","threadId":"local-thread"}})
            .as_object()
            .unwrap()
            .clone();
        for (index, admitted) in [old, handle.clone().with_authority(None)]
            .into_iter()
            .enumerate()
        {
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
                .is_none_or(|row| !row.fields.contains_key("emailName"))
        );
        drop(state);
        let current = handle
            .clone()
            .with_authority(Some(AuthorityAdmission::protected(Some(denied.generation))));
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
        let writer = handle
            .clone()
            .with_authority(Some(AuthorityAdmission::protected(Some(
                allowed.generation,
            ))));
        for (id, kind) in [
            ("doc-property", "DOCUMENT"),
            ("calendar-property", "CALENDAR_EVENT"),
            ("crm-property", "COMPANY"),
        ] {
            writer.write(WriteRequest { origin_op_id: None, registration: None,
                query: "mutation Set($input: SetEntityPropertyInput!) { setEntityProperty(input: $input) { __typename id propertyDefinitionId } }".into(), operation_name: Some("Set".into()),
                variables: json!({"input":{"entityId":"owner","entityType":kind}}).as_object().unwrap().clone(),
                data: json!({"setEntityProperty":{"__typename":"GraphqlProperty","id":id,"propertyDefinitionId":"definition"}}), identity: None }).await.unwrap();
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
