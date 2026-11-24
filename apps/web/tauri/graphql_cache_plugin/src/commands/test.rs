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
fn only_a_well_formed_traceparent_names_an_upstream_trace() {
    let id = "4bf92f3577b34da6a3ce929d0e0e4736";
    assert_eq!(
        super::upstream_trace_id(Some(&format!("00-{id}-00f067aa0ba902b7-01"))),
        Some(id)
    );
    for malformed in [
        format!("00-{id}-00f067aa0ba902b7-0\0"),
        format!("00-{id}-00f067aa0ba902b7-0z"),
        format!("00-{id}-00f067aa0ba902b7"),
        format!("00-{id}-00f067aa0ba902b7-01-"),
        "secret text".to_owned(),
    ] {
        assert_eq!(
            super::upstream_trace_id(Some(&malformed)),
            None,
            "{malformed:?}"
        );
    }
    assert_eq!(super::upstream_trace_id(None), None);
}

/// The bundled schema with a `runtimeLabel` of `declared` on users.
fn labelled(declared: &str) -> std::sync::Arc<cache_core::meta::Schema> {
    cache_core::meta::Schema::from_sdl(&format!(
        "{}\nextend type GraphqlUser {{ runtimeLabel: {declared} }}",
        cache_core::meta::BUNDLED_SCHEMA_SDL
    ))
    .unwrap()
}

const LABEL_QUERY: &str = "query { user { id runtimeLabel } }";

/// Writes a user with a label through `handle`.
async fn write_label(handle: &crate::engine::EngineHandle) {
    handle
        .write(crate::engine::WriteRequest {
            origin_op_id: None,
            registration: None,
            query: LABEL_QUERY.into(),
            operation_name: None,
            variables: serde_json::Map::new(),
            data: serde_json::json!({"user": {"id": "viewer", "runtimeLabel": "OTA"}}),
            identity: None,
        })
        .await
        .unwrap();
}

async fn label_hits(handle: &crate::engine::EngineHandle) -> bool {
    matches!(
        handle
            .read(
                None,
                LABEL_QUERY.into(),
                None,
                serde_json::Map::new(),
                vec![],
            )
            .await
            .unwrap(),
        crate::engine::ReadResultWire::Hit { .. }
    )
}

#[test]
fn an_older_builds_cache_upgrades_against_its_schema_file_and_the_file_goes() {
    pollster::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let written = labelled("String");
        let (storage, _, _) = super::open_cache(dir.path(), "scope", &written).unwrap();
        let handle = crate::engine::EngineHandle::with_schema(storage, None, written.clone());
        write_label(&handle).await;
        handle.shutdown().unwrap();
        // What an older build leaves: a storage 12 file, and the schema its
        // records were written under beside it.
        let database = cache_turso::TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
        let mut storage = database.open("scope").unwrap();
        cache_turso::migration_test_hooks::rewrite_as_storage_12(&mut storage).unwrap();
        storage.try_close().unwrap();
        let legacy = dir.path().join("schema.json");
        std::fs::write(&legacy, serde_json::to_vec(written.artifact()).unwrap()).unwrap();

        // The bundle an OTA rollback returns to lacks the label; the file
        // says the records hold one, so they stay and keep answering.
        let bundled = cache_core::meta::bundled_schema();
        let (storage, adoption, _) = super::open_cache(dir.path(), "scope", &bundled).unwrap();
        assert_eq!(storage.upgraded_from_storage_version(), Some(12));
        assert_eq!(
            adoption.change,
            Some(cache_core::schema_change::Tier::Compatible)
        );
        assert_eq!(adoption.dropped_records, 0);
        assert!(!legacy.exists());
        let handle = crate::engine::EngineHandle::with_schema(storage, None, adoption.schema);
        assert!(label_hits(&handle).await);
        handle.shutdown().unwrap();
    });
}

#[test]
fn an_unreadable_schema_file_drops_the_records_it_described() {
    // The bundled guess at what wrote a cache is for one that left no
    // schema file; one it cannot read could name any older schema.
    pollster::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let written = labelled("String");
        let (storage, _, _) = super::open_cache(dir.path(), "scope", &written).unwrap();
        let handle = crate::engine::EngineHandle::with_schema(storage, None, written.clone());
        write_label(&handle).await;
        handle.shutdown().unwrap();
        let database = cache_turso::TursoFileDatabase::new(dir.path().join("cache.turso")).unwrap();
        let mut storage = database.open("scope").unwrap();
        cache_turso::migration_test_hooks::rewrite_as_storage_12(&mut storage).unwrap();
        storage.try_close().unwrap();
        std::fs::write(dir.path().join("schema.json"), b"{").unwrap();

        let (storage, adoption, _) = super::open_cache(dir.path(), "scope", &written).unwrap();
        assert_eq!(
            adoption.change,
            Some(cache_core::schema_change::Tier::Reset(
                cache_core::schema_change::ResetReason::Unreadable
            ))
        );
        let handle = crate::engine::EngineHandle::with_schema(storage, None, adoption.schema);
        assert!(!label_hits(&handle).await);
        handle.shutdown().unwrap();
    });
}

#[test]
fn a_build_that_retypes_a_field_opens_without_that_types_records() {
    // Native init used to refuse a build whose schema changed a stored
    // type's shape, leaving the webview on the network; now the type's
    // records go and the rest of the cache opens.
    pollster::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let written = labelled("String");
        let (storage, _, _) = super::open_cache(dir.path(), "scope", &written).unwrap();
        let handle = crate::engine::EngineHandle::with_schema(storage, None, written);
        write_label(&handle).await;
        assert!(label_hits(&handle).await);
        handle.shutdown().unwrap();

        let retyped = labelled("[String]");
        let (storage, adoption, _) = super::open_cache(dir.path(), "scope", &retyped).unwrap();
        let Some(cache_core::schema_change::Tier::Types { changed, .. }) = &adoption.change else {
            panic!("{:?}", adoption.change);
        };
        assert!(changed.contains("GraphqlUser"), "{changed:?}");
        assert!(adoption.dropped_records > 0);
        let handle = crate::engine::EngineHandle::with_schema(storage, None, adoption.schema);
        assert!(!label_hits(&handle).await);
        handle.install_schema(&retyped).await.unwrap();
        handle.shutdown().unwrap();
    });
}

#[test]
fn a_native_open_reports_what_it_did_to_the_cache() {
    pollster::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let written = labelled("String");
        let (storage, _, fresh) = super::open_cache(dir.path(), "scope", &written).unwrap();
        assert_eq!(fresh.change, "unchanged");
        assert!(!fresh.physical_reset);
        let handle = crate::engine::EngineHandle::with_schema(storage, None, written);
        write_label(&handle).await;
        handle.shutdown().unwrap();

        let retyped = labelled("[String]");
        let (storage, _, report) = super::open_cache(dir.path(), "scope", &retyped).unwrap();
        assert_eq!(report.change, "types");
        assert!(report.changed_types > 0);
        assert!(report.dropped_records > 0);
        assert!(!report.physical_reset);
        // The webview reads it as the worker's `schemaChange`.
        let wire = serde_json::to_value(&report).unwrap();
        assert_eq!(wire["change"], "types");
        assert_eq!(wire["physicalReset"], false);
        assert!(wire["changedTypes"].as_u64().unwrap() > 0);
        assert!(wire.get("resetReason").is_none());
        storage.try_close().unwrap();
    });
}

#[test]
fn a_cache_that_cannot_adopt_the_schema_in_place_reports_its_replacement() {
    pollster::block_on(async {
        let dir = tempfile::tempdir().unwrap();
        let written = labelled("String");
        let (storage, _, _) = super::open_cache(dir.path(), "scope", &written).unwrap();
        let handle = crate::engine::EngineHandle::with_schema(storage, None, written.clone());
        write_label(&handle).await;
        handle.shutdown().unwrap();
        cache_turso::migration_test_hooks::corrupt_next_adoption();

        let (storage, adoption, report) = super::open_cache(dir.path(), "scope", &written).unwrap();
        assert!(report.physical_reset);
        assert_eq!(report.change, "unchanged");
        let handle = crate::engine::EngineHandle::with_schema(storage, None, adoption.schema);
        assert!(!label_hits(&handle).await);
        handle.shutdown().unwrap();
    });
}
