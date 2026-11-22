//! Serializer-checked fixture for the browser's seeded RCPT550 projection test.
use models_email::service::message::{
    SubmissionRefusal, SubmissionRefusalClass, SubmissionRefusalPhase,
};

fn recipient_refusal_json() -> String {
    let refusal = SubmissionRefusal {
        phase: SubmissionRefusalPhase::Recipient,
        recipient_index: Some(0),
        reply_class: Some(SubmissionRefusalClass::Permanent),
    };
    format!(
        "{}\n",
        serde_json::to_string_pretty(&refusal).expect("serialize typed refusal")
    )
}

#[test]
fn browser_refusal_fixture_matches_the_real_serializer() {
    assert_eq!(
        recipient_refusal_json(),
        include_str!("fixtures/recipient-refusal.json")
    );
}

#[test]
#[ignore = "regenerates the checked-in browser fixture; run explicitly after changing the wire type"]
fn regenerate_browser_refusal_fixture() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/recipient-refusal.json");
    std::fs::write(path, recipient_refusal_json()).expect("write generated browser fixture");
}
