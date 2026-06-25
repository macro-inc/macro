use super::*;

#[test]
fn default_is_smart() {
    assert_eq!(PredefinedModel::default(), PredefinedModel::Smart);
}

#[test]
fn smart_is_opus_4_8() {
    assert_eq!(PredefinedModel::Smart.api_id(), "claude-opus-4-8");
    assert_eq!(
        serde_json::to_string(&PredefinedModel::Smart).unwrap(),
        r#""claude-opus-4-8""#
    );
}

#[test]
fn fast_is_haiku() {
    assert_eq!(PredefinedModel::Fast.api_id(), "claude-haiku-4-5");
    assert_eq!(
        PredefinedModel::Fast.api_id(),
        PredefinedModel::Haiku4_5.api_id()
    );
}

#[test]
fn retired_uses_default_api_id() {
    assert_eq!(
        PredefinedModel::Retired.api_id(),
        PredefinedModel::Smart.api_id()
    );
}

#[test]
fn variants_serialize_to_their_api_id() {
    for m in [
        PredefinedModel::Smart,
        PredefinedModel::Fast,
        PredefinedModel::Opus4_7,
        PredefinedModel::Sonnet4_6,
        PredefinedModel::Haiku4_5,
        PredefinedModel::Gpt5_5,
        PredefinedModel::Gpt5Mini,
        PredefinedModel::Retired,
    ] {
        let wire = serde_json::to_string(&m).unwrap();
        assert_eq!(wire, format!(r#""{}""#, m.api_id()), "{m:?}");
    }
}
