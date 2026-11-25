#[tokio::test]
async fn schema_depth_ceiling_retains_headroom_and_rejects_deep_nesting() {
    let schema = crate::build_schema();
    for (depth, allowed) in [(10, true), (32, true), (33, false)] {
        let mut selection = "kind".to_string();
        for _ in 2..depth {
            selection = format!("ofType {{ {selection} }}");
        }
        let response = schema
            .execute(format!("{{ __type(name: \"String\") {{ {selection} }} }}"))
            .await;
        // Count the __type root and the kind leaf in the total depth.
        if allowed {
            assert!(response.errors.is_empty(), "{:?}", response.errors);
        } else {
            assert!(
                response
                    .errors
                    .iter()
                    .any(|error| error.message.contains("depth")
                        || error.message.contains("nested too deep")),
                "{:?}",
                response.errors
            );
        }
    }
}

#[test]
fn dependency_states_are_flat_and_document_dependents_keep_canonical_type() {
    let sdl = crate::build_schema().sdl();
    let state = sdl
        .split_once("type GraphqlTaskDependencyState {")
        .unwrap()
        .1
        .split_once('}')
        .unwrap()
        .0;
    assert!(!state.contains("dependentTasks"));
    let document = sdl
        .split_once("type GraphqlSoupDocument implements GraphqlSoupEntity {")
        .unwrap()
        .1
        .split_once('}')
        .unwrap()
        .0;
    assert!(document.contains("dependentTasks: [GraphqlTaskDependencyState!]!"));
}
