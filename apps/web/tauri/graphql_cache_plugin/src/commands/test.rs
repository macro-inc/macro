use super::HydrationResultWire;

#[test]
fn scoped_first_binding_preserves_the_generation_without_notifying_windows() {
    use cache_core::engine::authority::CacheAuthority;
    use std::sync::{Arc, Mutex};
    use tauri::{Listener, Manager};

    for publication in ["write", "hydrate", "scoped-hydrate", "people"] {
        let handle = crate::engine::EngineHandle::new(
            cache_turso::TursoStorage::open_in_memory("profile").unwrap(),
            None,
        );
        let before = pollster::block_on(handle.current_authority("profile")).unwrap();
        let inspect = handle.clone();
        let mut scope = cache_core::engine::HydrationScope {
            identity: "macro|viewer@example.com".into(),
            storage_generation: pollster::block_on(handle.current_storage_generation())
                .unwrap()
                .parse()
                .unwrap(),
            contact_fence: None,
        };
        if publication == "people" {
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
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let emitter = app.handle().clone();
        let competing = handle.clone();
        let handle = handle.with_authority_listener("profile".into(), move |authority| {
            crate::emit_cache_event(&emitter, "graphql-cache://authority-changed", authority);
        });
        app.manage(crate::CacheState(Mutex::new(Some(
            crate::InitializedCache {
                scope: "profile".into(),
                handle,
                webview_clients: Default::default(),
                any_untracked_client: false,
            },
        ))));
        let events = Arc::new(Mutex::new(Vec::<CacheAuthority>::new()));
        let received = events.clone();
        app.listen("graphql-cache://authority-changed", move |event| {
            // The event must be sent before another command can acquire the owner.
            let mut next = std::pin::pin!(competing.current_revision());
            let mut context = std::task::Context::from_waker(std::task::Waker::noop());
            assert!(std::future::Future::poll(next.as_mut(), &mut context).is_pending());
            received
                .lock()
                .unwrap()
                .push(serde_json::from_str(event.payload()).unwrap());
        });
        pollster::block_on(async {
            let query = "{ user { id } }".to_owned();
            let data = serde_json::json!({"user": {"id": "macro|viewer@example.com"}});
            let identity = Some("macro|viewer@example.com".into());
            match publication {
                "write" => {
                    super::graphql_cache_write(
                        app.handle().clone(),
                        app.state(),
                        Some(before.generation),
                        None,
                        None,
                        query,
                        None,
                        None,
                        data,
                        identity,
                        None,
                    )
                    .await
                    .unwrap();
                }
                "hydrate" => {
                    super::graphql_cache_hydrate(
                        app.handle().clone(),
                        app.state(),
                        Some(before.generation),
                        query,
                        None,
                        None,
                        data,
                        identity,
                        None,
                    )
                    .await
                    .unwrap();
                }
                "scoped-hydrate" => {
                    super::graphql_cache_hydrate_scoped(
                        app.state(),
                        Some(before.generation),
                        super::ScopedHydrationRequest {
                            query,
                            operation_name: None,
                            variables: None,
                            data,
                            identity,
                            hydration_scope: scope,
                        },
                        None,
                    )
                    .await
                    .unwrap();
                }
                "people" => {
                    super::graphql_cache_people_update(
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
                }
                _ => unreachable!(),
            }
        });
        let events = events.lock().unwrap();
        assert!(events.is_empty());
        let after = pollster::block_on(inspect.current_authority("profile")).unwrap();
        assert_eq!(after.generation, before.generation);
        assert_eq!(after.account.as_deref(), Some("macro|viewer@example.com"));
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

#[test]
fn legacy_payloads_omit_generation_through_the_invoke_handler() {
    let handle = crate::engine::EngineHandle::new(
        cache_turso::TursoStorage::open_in_memory("legacy-profile").unwrap(),
        None,
    );
    let app = tauri::test::mock_builder()
        .manage(crate::CacheState(std::sync::Mutex::new(Some(
            crate::InitializedCache {
                scope: "legacy-profile".into(),
                handle,
                webview_clients: Default::default(),
                any_untracked_client: true,
            },
        ))))
        .invoke_handler(tauri::generate_handler![
            super::graphql_cache_write,
            super::graphql_cache_read,
            super::graphql_cache_watch
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    for (command, body) in [
        (
            "graphql_cache_write",
            serde_json::json!({"query":"{ user { id } }", "data":{"user":{"id":"viewer"}}, "identity":"viewer"}),
        ),
        (
            "graphql_cache_read",
            serde_json::json!({"query":"{ user { id } }"}),
        ),
        (
            "graphql_cache_watch",
            serde_json::json!({"query":"{ user { id } }", "opId":"legacy:watch"}),
        ),
    ] {
        assert!(body.get("generation").is_none());
        assert!(body.get("authority").is_none());
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
        )
        .expect("deployed argument omissions must reach the engine")
        .deserialize::<serde_json::Value>()
        .unwrap();
        if command != "graphql_cache_write" {
            assert_eq!(response["kind"], "hit");
            assert_eq!(
                response["data"],
                serde_json::json!({"user":{"id":"viewer"}})
            );
        }
    }
}

#[test]
fn teardown_webview_prunes_only_terminated_webview_clients_and_supports_single_webview_fallback() {
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;

    pollster::block_on(async {
        let handle = crate::engine::EngineHandle::new(
            cache_turso::TursoStorage::open_in_memory("teardown-profile").unwrap(),
            None,
        );
        let query = "{ user { id } }".to_owned();
        let initial = serde_json::json!({"user": {"id": "viewer-1"}});
        let updated = serde_json::json!({"user": {"id": "viewer-2"}});
        handle
            .write(crate::engine::WriteRequest {
                origin_op_id: None,
                registration: None,
                query: query.clone(),
                operation_name: None,
                variables: Default::default(),
                data: initial,
                identity: None,
            })
            .await
            .unwrap();
        for op_id in ["main-client:1", "main-client:2", "other-client:1"] {
            let _ = handle
                .read(
                    Some(op_id.to_owned()),
                    query.clone(),
                    None,
                    Default::default(),
                    Vec::new(),
                )
                .await
                .unwrap();
        }
        let mut webview_clients = HashMap::new();
        webview_clients.insert("main".to_owned(), HashSet::from(["main-client".to_owned()]));
        webview_clients.insert(
            "secondary".to_owned(),
            HashSet::from(["other-client".to_owned()]),
        );
        let state = crate::CacheState(Mutex::new(Some(crate::InitializedCache {
            scope: "teardown-profile".into(),
            handle: handle.clone(),
            webview_clients,
            any_untracked_client: false,
        })));

        // Snapshot dead clients synchronously BEFORE a replacement document
        // initializes on the same webview label, then finish teardown async.
        let teardown_main = state.teardown_webview("main", true);
        {
            let mut guard = state.0.lock().unwrap();
            guard
                .as_mut()
                .unwrap()
                .webview_clients
                .entry("main".to_owned())
                .or_default()
                .insert("replacement-client".to_owned());
        }
        let _ = handle
            .read(
                Some("replacement-client:1".to_owned()),
                query.clone(),
                None,
                Default::default(),
                Vec::new(),
            )
            .await
            .unwrap();

        let removed = teardown_main.await;
        assert_eq!(removed, 2);
        let write = handle
            .write(crate::engine::WriteRequest {
                origin_op_id: None,
                registration: None,
                query: query.clone(),
                operation_name: None,
                variables: Default::default(),
                data: updated,
                identity: None,
            })
            .await
            .unwrap();
        let mut remaining = write.affected_ops;
        remaining.sort();
        assert_eq!(remaining, vec!["other-client:1", "replacement-client:1"]);

        // Duplicate termination with no untracked legacy clients is a safe no-op.
        assert_eq!(state.teardown_webview("unknown-label", true).await, 0);

        // Single-webview mobile fallback tears down untracked legacy-bundle ops.
        state
            .0
            .lock()
            .unwrap()
            .as_mut()
            .unwrap()
            .any_untracked_client = true;
        let removed_fallback = state.teardown_webview("untracked-main", true).await;
        assert_eq!(removed_fallback, 2);
        let write_after = handle
            .write(crate::engine::WriteRequest {
                origin_op_id: None,
                registration: None,
                query,
                operation_name: None,
                variables: Default::default(),
                data: serde_json::json!({"user": {"id": "viewer-3"}}),
                identity: None,
            })
            .await
            .unwrap();
        assert!(write_after.affected_ops.is_empty());
    });
}
