use super::HydrationResultWire;

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
