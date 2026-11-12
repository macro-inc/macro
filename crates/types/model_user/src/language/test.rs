use std::str::FromStr;

use strum::IntoEnumIterator;

use super::Language;

#[test]
fn wire_and_database_spellings_match() {
    for language in Language::iter() {
        let json = serde_json::to_string(&language).unwrap();
        assert_eq!(json, format!("\"{}\"", language.as_str()));
        assert_eq!(Language::from_str(language.as_str()).unwrap(), language);
    }
}

#[test]
fn parses_bcp_47_tags() {
    assert_eq!(
        serde_json::from_str::<Language>("\"pt-PT\"").unwrap(),
        Language::PortuguesePortugal
    );
    assert_eq!(
        serde_json::from_str::<Language>("\"zh-Hant\"").unwrap(),
        Language::ChineseTraditional
    );
    assert!(serde_json::from_str::<Language>("\"pt\"").is_err());
    assert!(Language::from_str("EN").is_err());
}
