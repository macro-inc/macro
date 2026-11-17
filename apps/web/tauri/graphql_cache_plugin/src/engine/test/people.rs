use super::*;
use cache_core::people::{
    ContextAction, ContextState, ContextUpdate, PeopleMode, PeopleReferenceRequest,
    PeopleReferenceResult, PeopleSearch, PeopleSearchResult, ReferenceMatchMode,
};

#[test]
fn native_person_policy_preserves_scope_and_publication() {
    block_on(async {
        let handle = spawn_handle();
        let viewer = "macro|viewer@example.com";
        let user = "macro|person@example.com";
        let contact = "8b6318fd-4063-5ddb-90c2-83a401b63538";
        let mut scope = HydrationScope {
            contact_fence: None,
            storage_generation: handle
                .current_storage_generation()
                .await
                .unwrap()
                .parse()
                .unwrap(),
            identity: viewer.into(),
        };
        assert_eq!(
            handle.people_context(scope.clone()).await.unwrap(),
            ContextState::Missing
        );
        scope.contact_fence = Some(
            handle
                .contact_snapshot(cache_core::people::sync::ContactSnapshotRequest {
                    scope: scope.clone(),
                    scan: None,
                })
                .await
                .unwrap()
                .fence,
        );
        handle.hydrate_query(
            "{ user { id contacts(limit: 1) { nodes { __typename id userId name email } nextCursor } } }".into(),
            None, Variables::new(),
            serde_json::json!({"user":{"id":viewer,"contacts":{"nodes":[{"__typename":"GraphqlContact","id":contact,"userId":user,"name":"Private label","email":"person@example.com"}],"nextCursor":null}}}),
            Some(viewer.into()), Some(scope.clone()),
        ).await.unwrap();
        let sql = cache_core::people::sql::PeopleSqlRequest {
            scope: scope.clone(),
            input: cache_core::people::sql::PeopleSqlInput::Statement {
                sql: "SELECT name, row_position FROM macro.people".into(),
            },
        };
        let answer =
            serde_json::to_value(handle.people_read_sql(sql.clone()).await.unwrap()).unwrap();
        assert_eq!(answer["kind"], "result");
        assert_eq!(
            answer["outcome"]["rows"],
            serde_json::json!([[{"type":"text","value":"Private label"},null]])
        );
        let references = PeopleReferenceRequest {
            scope: scope.clone(),
            labels: vec!["Private".into(), "Private label".into(), "missing".into()],
            matching: ReferenceMatchMode::PreferFullName,
            exclude_secondary_inboxes: false,
        };
        let PeopleReferenceResult::Resolved { matches, .. } = handle
            .people_resolve_references(references.clone())
            .await
            .unwrap()
        else {
            panic!("resolved")
        };
        assert_eq!(matches[0].people[0].user_id.as_ref(), user);
        assert_eq!(matches[1].people[0].name.as_deref(), Some("Private label"));
        assert!(matches[2].people.is_empty());
        assert!(matches.iter().all(|entry| entry.complete));
        let epoch = "00000000-0000-4000-8000-000000000002".parse().unwrap();
        handle
            .people_update(ContextUpdate {
                scope: scope.clone(),
                epoch,
                action: ContextAction::Begin {
                    previous_epoch: None,
                },
            })
            .await
            .unwrap();
        let request = PeopleSearch {
            scope: scope.clone(),
            mode: PeopleMode::Command,
            query: "private".into(),
            excluded: vec![],
            sender_domain: None,
            limit: 1,
            now_ms: 0,
            cursor: None,
        };
        assert!(matches!(
            handle.people_search(request.clone()).await.unwrap(),
            PeopleSearchResult::ContextPending
        ));
        let commit = ContextUpdate {
            scope: scope.clone(),
            epoch,
            action: ContextAction::Commit,
        };
        assert!(
            handle
                .people_update(commit.clone())
                .await
                .unwrap()
                .revision_advanced
        );
        assert!(
            !handle
                .people_update(commit.clone())
                .await
                .unwrap()
                .revision_advanced
        );
        let PeopleSearchResult::Page { people, .. } =
            handle.people_search(request.clone()).await.unwrap()
        else {
            panic!("published")
        };
        assert_eq!(people[0].user_id.as_ref(), user);
        assert_eq!(people[0].name, "Private label");
        assert_eq!(
            people[0].record_key.0.to_string(),
            format!("GraphqlContact:{contact}")
        );
        let snapshot = handle
            .contact_snapshot(cache_core::people::sync::ContactSnapshotRequest {
                scope: scope.clone(),
                scan: Some(cache_core::people::sync::ContactScan {
                    after: None,
                    limit: 500,
                }),
            })
            .await
            .unwrap();
        assert_eq!(snapshot.ids.len(), 1);
        let removal = handle
            .contact_reconcile(cache_core::people::sync::ContactReconcile {
                scope: scope.clone(),
                fence: snapshot.fence,
                viewer: viewer.into(),
                requested: snapshot.ids,
                present: vec![],
            })
            .await
            .unwrap();
        assert!(removal.revision_advanced);
        assert_eq!(removal.changed.len(), 1);
        let answer =
            serde_json::to_value(handle.people_read_sql(sql.clone()).await.unwrap()).unwrap();
        assert_eq!(answer["outcome"]["rows"], serde_json::json!([]));
        handle.clear().await.unwrap();
        assert_eq!(
            handle.people_read_sql(sql).await.err().as_deref(),
            Some("cache hydration scope changed")
        );
        assert_eq!(
            handle
                .people_resolve_references(references)
                .await
                .err()
                .as_deref(),
            Some("cache hydration scope changed")
        );
        assert_eq!(
            handle.people_update(commit).await.err().as_deref(),
            Some("cache hydration scope changed")
        );
        assert_eq!(
            handle.people_search(request).await.err().as_deref(),
            Some("cache hydration scope changed")
        );
    });
}
