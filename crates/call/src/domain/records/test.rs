use super::{CallProvider, CallSource, CallTranscript};
use serde_json::json;

#[test]
fn source_requires_a_supported_provider() {
    let mut source = json!({
        "userId": "macro|call-model@test.com",
        "namespace": "account-1",
        "provider": "granola",
        "objectType": "note",
        "externalId": "not_opaque"
    });

    for (value, expected) in [
        ("macro", CallProvider::Macro),
        ("granola", CallProvider::Granola),
    ] {
        source["provider"] = json!(value);
        let parsed: CallSource = serde_json::from_value(source.clone()).unwrap();
        assert_eq!(parsed.provider, expected);
        assert_eq!(serde_json::to_value(parsed).unwrap()["provider"], value);
    }

    for invalid in [json!("unknown"), json!(""), json!(null)] {
        source["provider"] = invalid;
        assert!(serde_json::from_value::<CallSource>(source.clone()).is_err());
    }
    source.as_object_mut().unwrap().remove("provider");
    assert!(serde_json::from_value::<CallSource>(source).is_err());
}

#[test]
fn transcript_provider_is_optional_but_validated_when_present() {
    let mut transcript = json!({"id": "019a0000-0000-7000-8000-000000000050"});
    assert!(
        serde_json::from_value::<CallTranscript>(transcript.clone())
            .unwrap()
            .provider
            .is_none()
    );

    for (value, expected) in [
        (json!(null), None),
        (json!("macro"), Some(CallProvider::Macro)),
        (json!("granola"), Some(CallProvider::Granola)),
    ] {
        transcript["provider"] = value.clone();
        let parsed: CallTranscript = serde_json::from_value(transcript.clone()).unwrap();
        assert_eq!(parsed.provider, expected);
        assert_eq!(serde_json::to_value(parsed).unwrap()["provider"], value);
    }

    transcript["provider"] = json!("unknown");
    assert!(serde_json::from_value::<CallTranscript>(transcript).is_err());
}
