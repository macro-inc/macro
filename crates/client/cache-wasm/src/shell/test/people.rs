use super::*;

#[wasm_bindgen_test(async)]
async fn people_abi_preserves_scope_publication_and_winning_identity() {
    let engine = fresh_engine("people-abi").await;
    let generation = resolved(engine.current_storage_generation())
        .await
        .as_string()
        .unwrap();
    let viewer = "macro|viewer@example.com";
    let user = "macro|person@example.com";
    let contact = uuid::Uuid::new_v5(
        &uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, viewer.as_bytes()),
        user.as_bytes(),
    )
    .to_string();
    let mut scope = serde_json::json!({"storageGeneration":generation,"identity":viewer});
    let snapshot: serde_json::Value =
        from_js(resolved(engine.contact_snapshot(js(serde_json::json!({"scope":scope})))).await);
    scope["contactFence"] = snapshot["fence"].clone();
    let epoch = uuid::Uuid::now_v7().to_string();
    let missing: serde_json::Value =
        from_js(resolved(engine.people_context(js(scope.clone()))).await);
    assert_eq!(missing["kind"], "missing");
    resolved(engine.hydrate_query(
        "{ user { id contacts(limit: 1) { nodes { __typename id userId name email } nextCursor } } }".into(),
        None, js(serde_json::json!({})),
        js(serde_json::json!({"user":{"id":viewer,"contacts":{"nodes":[{"__typename":"GraphqlContact","id":contact,"userId":user,"name":"Private label","email":"person@example.com"}],"nextCursor":null}}})),
        Some(viewer.into()), js(scope.clone()),
    )).await;
    let sql = serde_json::json!({"scope":scope,"input":{"kind":"statement","sql":"SELECT name, row_position FROM macro.people"}});
    let answer: serde_json::Value =
        from_js(resolved(engine.people_read_sql(js(sql.clone()))).await);
    assert_eq!(answer["kind"], "result");
    assert_eq!(
        answer["outcome"]["rows"],
        serde_json::json!([[{"type":"text","value":"Private label"},null]])
    );
    assert_eq!(
        answer["outcome"]["readTables"],
        serde_json::json!(["6d616372-6f00-0000-0000-000070656f70"])
    );
    let references = serde_json::json!({"scope":scope,"labels":["Private", "Private label", "missing"],"matching":"preferFullName","excludeSecondaryInboxes":false});
    let matched: serde_json::Value =
        from_js(resolved(engine.people_resolve_references(js(references.clone()))).await);
    assert_eq!(matched["kind"], "resolved");
    assert_eq!(matched["matches"][0]["people"][0]["userId"], user);
    assert_eq!(matched["matches"][1]["people"][0]["name"], "Private label");
    assert_eq!(matched["matches"][2]["people"], serde_json::json!([]));
    assert_eq!(matched["matches"][0]["complete"], true);
    let begin = serde_json::json!({"scope":scope,"epoch":epoch,"action":{"kind":"begin","previousEpoch":null}});
    resolved(engine.people_update(js(begin))).await;
    let request = serde_json::json!({"scope":scope,"query":"private","mode":"command","limit":1,"excluded":[],"nowMs":0});
    let pending: serde_json::Value =
        from_js(resolved(engine.people_search(js(request.clone()))).await);
    assert_eq!(pending["kind"], "contextPending");
    let commit = serde_json::json!({"scope":scope,"epoch":epoch,"action":{"kind":"commit"}});
    resolved(engine.people_update(js(commit.clone()))).await;
    let page: serde_json::Value =
        from_js(resolved(engine.people_search(js(request.clone()))).await);
    assert_eq!(page.get("nextCursor"), Some(&serde_json::Value::Null));
    assert_eq!(page["people"][0]["userId"], user);
    assert_eq!(page["people"][0]["name"], "Private label");
    assert_eq!(
        page["people"][0]["recordKey"],
        format!("GraphqlContact:{contact}")
    );
    let snapshot: serde_json::Value = from_js(
        resolved(engine.contact_snapshot(js(
            serde_json::json!({"scope":scope,"scan":{"after":null,"limit":500}}),
        )))
        .await,
    );
    assert_eq!(snapshot["ids"], serde_json::json!([user]));
    let removal: serde_json::Value = from_js(resolved(engine.contact_reconcile(js(serde_json::json!({"scope":scope,"fence":snapshot["fence"],"viewer":viewer,"requested":snapshot["ids"],"present":[]})))).await);
    assert_eq!(removal["revisionAdvanced"], true);
    let answer: serde_json::Value =
        from_js(resolved(engine.people_read_sql(js(sql.clone()))).await);
    assert_eq!(answer["outcome"]["rows"], serde_json::json!([]));
    resolved(engine.clear()).await;
    assert!(
        JsFuture::from(engine.people_read_sql(js(sql)))
            .await
            .is_err()
    );
    assert!(
        JsFuture::from(engine.people_update(js(commit)))
            .await
            .is_err()
    );
    assert!(
        JsFuture::from(engine.people_search(js(request)))
            .await
            .is_err()
    );
    assert!(
        JsFuture::from(engine.people_resolve_references(js(references)))
            .await
            .is_err()
    );
    close_and_destroy(&engine, "people-abi").await;
}
