use std::str::FromStr;

use strum::IntoEnumIterator;

use super::DocumentSubType;

#[test]
fn serde_and_strum_agree_on_snake_case_for_every_variant() {
    for variant in DocumentSubType::iter() {
        let display = variant.to_string();
        let json = serde_json::to_string(&variant).expect("serializes");
        assert_eq!(json, format!("\"{display}\""), "{variant:?}");
        assert_eq!(
            DocumentSubType::from_str(&display).expect("parses"),
            variant
        );
        assert_eq!(
            serde_json::from_str::<DocumentSubType>(&json).expect("deserializes"),
            variant
        );
    }
}

#[test]
fn every_variant_has_its_database_spelling() {
    let spellings: Vec<String> = DocumentSubType::iter().map(|v| v.to_string()).collect();
    assert_eq!(
        spellings,
        ["task", "snippet", "skill", "initiative_description"]
    );
}
