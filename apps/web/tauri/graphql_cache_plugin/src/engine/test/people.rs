use super::*;
use cache_core::people::{
    ContextAction, ContextState, ContextUpdate, PeopleMode, PeopleSearch, PeopleSearchResult,
};

#[test]
fn native_person_policy_preserves_scope_and_publication() {
    block_on(async {
        let handle = spawn_handle();
        let viewer = "macro|viewer@example.com";
        let user = "macro|person@example.com";
        let contact = "8b6318fd-4063-5ddb-90c2-83a401b63538";
        let scope = HydrationScope {
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
        handle.hydrate_query(
            "{ user { id contacts(limit: 1) { nodes { __typename id userId name email } nextCursor } } }".into(),
            None, Variables::new(),
            serde_json::json!({"user":{"id":viewer,"contacts":{"nodes":[{"__typename":"GraphqlContact","id":contact,"userId":user,"name":"Private label","email":"person@example.com"}],"nextCursor":null}}}),
            Some(viewer.into()), Some(scope.clone()),
        ).await.unwrap();
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
        handle.clear().await.unwrap();
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
