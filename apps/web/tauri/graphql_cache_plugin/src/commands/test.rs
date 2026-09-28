use super::HydrationResultWire;

#[test]
fn hydration_results_preserve_the_native_advancement_bit() {
    for revision_advanced in [false, true] {
        for result in [
            HydrationResultWire::Data {
                data: serde_json::json!({"cursor": null}),
                revision: "7".to_string(),
                revision_advanced,
            },
            HydrationResultWire::Void {
                revision: "7".to_string(),
                revision_advanced,
            },
        ] {
            let json = serde_json::to_value(result).unwrap();
            assert_eq!(json["revisionAdvanced"], revision_advanced);
            assert_eq!(json["revision"], "7");
            assert!(json.get("revision_advanced").is_none());
        }
    }
}
