use super::*;

#[test]
fn native_features_are_checked_before_model_or_session_builds() {
    for (job, build) in [
        (native(false), "Model unit and handwritten tests"),
        (session(), "Session wasm, size and host contract"),
    ] {
        let value = serde_json::to_value(job).unwrap();
        let steps = value["steps"].as_array().unwrap();
        let guard = steps
            .iter()
            .position(|step| step["name"] == "Enforce native editor feature isolation")
            .expect("feature guard");
        let compilation = steps
            .iter()
            .position(|step| step["name"] == build)
            .expect("compilation step");
        assert!(guard < compilation);
        assert_eq!(
            steps[guard]["run"],
            "bun apps/web/scripts/native-editor-features.ts"
        );
    }
}
