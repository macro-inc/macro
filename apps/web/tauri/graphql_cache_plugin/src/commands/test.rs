use super::HydrationResultWire;

#[test]
fn scoped_first_binding_notifies_every_window() {
    use cache_core::engine::authority::CacheAuthority;
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};

    for people in [false, true] {
        let handle = crate::engine::EngineHandle::new(
            cache_turso::TursoStorage::open_in_memory("profile").unwrap(),
            None,
        );
        let before = pollster::block_on(handle.current_authority("profile")).unwrap();
        let mut scope = cache_core::engine::HydrationScope {
            identity: "macro|viewer@example.com".into(),
            storage_generation: pollster::block_on(handle.current_storage_generation())
                .unwrap()
                .parse()
                .unwrap(),
            contact_fence: None,
        };
        if people {
            scope.contact_fence = Some(
                pollster::block_on(handle.contact_snapshot(
                    cache_core::people::sync::ContactSnapshotRequest {
                        scope: scope.clone(),
                        scan: None,
                    },
                ))
                .unwrap()
                .fence,
            );
        }
        let app = tauri::test::mock_builder()
            .manage(crate::CacheState(Mutex::new(Some(
                crate::InitializedCache {
                    scope: "profile".into(),
                    handle,
                },
            ))))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let events = Arc::new(Mutex::new(Vec::<CacheAuthority>::new()));
        let received = events.clone();
        app.listen("graphql-cache://authority-changed", move |event| {
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap());
        });
        pollster::block_on(async {
            if people {
                super::graphql_cache_people_update(
                    app.handle().clone(),
                    app.state(),
                    Some(before.generation),
                    cache_core::people::ContextUpdate {
                        scope,
                        epoch: uuid::Uuid::now_v7(),
                        action: cache_core::people::ContextAction::Begin {
                            previous_epoch: None,
                        },
                    },
                    None,
                )
                .await
                .unwrap();
            } else {
                super::graphql_cache_hydrate_scoped(
                    app.handle().clone(),
                    app.state(),
                    Some(before.generation),
                    super::ScopedHydrationRequest {
                        query: "{ user { id } }".into(),
                        operation_name: None,
                        variables: None,
                        data: serde_json::json!({"user": {"id": "macro|viewer@example.com"}}),
                        identity: Some("macro|viewer@example.com".into()),
                        hydration_scope: scope,
                    },
                    None,
                )
                .await
                .unwrap();
            }
        });
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_ne!(events[0].generation, before.generation);
        assert_eq!(
            events[0].account.as_deref(),
            Some("macro|viewer@example.com")
        );
    }
}

#[test]
fn hydration_results_preserve_the_native_advancement_bit() {
    for revision_advanced in [false, true] {
        for result in [
            HydrationResultWire::Data {
                unchanged_views: vec!["window".into()],
                search_changed_buckets: ["note".into()].into(),
                data: serde_json::json!({"cursor": null}),
                revision: "7".to_string(),
                revision_advanced,
            },
            HydrationResultWire::Void {
                unchanged_views: vec!["window".into()],
                search_changed_buckets: ["note".into()].into(),
                revision: "7".to_string(),
                revision_advanced,
            },
        ] {
            let json = serde_json::to_value(result).unwrap();
            assert_eq!(json["revisionAdvanced"], revision_advanced);
            assert_eq!(json["revision"], "7");
            assert_eq!(json["unchangedViews"], serde_json::json!(["window"]));
            assert_eq!(json["searchChangedBuckets"], serde_json::json!(["note"]));
            assert!(json.get("revision_advanced").is_none());
        }
    }
}

#[test]
fn cache_commands_preserve_flat_arguments_and_validate_write_generations() {
    let app = tauri::test::mock_builder()
        .manage(crate::CacheState::default())
        .invoke_handler(tauri::generate_handler![
            super::graphql_cache_read,
            super::graphql_cache_write,
            super::graphql_cache_rollback_optimistic_write,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    for (command, body) in [
        (
            "graphql_cache_write",
            serde_json::json!({"query": "{ user { id } }", "data": {"user":{"id":"viewer"}}}),
        ),
        (
            "graphql_cache_read",
            serde_json::json!({"query": "{ user { id } }"}),
        ),
        (
            "graphql_cache_rollback_optimistic_write",
            serde_json::json!({
                "transactionId": "queued-write",
                "leaseOwner": "native-owner",
                "leaseGeneration": "1",
                "error": "Rejected",
            }),
        ),
    ] {
        for generation in [
            None,
            Some(serde_json::Value::Null),
            Some(serde_json::json!("00000000-0000-0000-0000-000000000001")),
            Some(serde_json::json!("invalid")),
        ] {
            let malformed = generation.as_ref().is_some_and(|value| value == "invalid");
            let mut body = body.clone();
            if let Some(generation) = generation {
                body["generation"] = generation;
            }
            let response = tauri::test::get_ipc_response(
                &webview,
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: if cfg!(any(windows, target_os = "android")) {
                        "http://tauri.localhost"
                    } else {
                        "tauri://localhost"
                    }
                    .parse()
                    .unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
            );
            let error = response.expect_err("the cache was not initialized");
            if malformed && command == "graphql_cache_write" {
                assert!(error.as_str().unwrap().starts_with(&format!(
                    "invalid args `generation` for command `{command}`:"
                )));
            } else {
                assert_eq!(
                    error,
                    "graphql cache not initialized (call graphql_cache_init first)"
                );
            }
        }
    }
}
