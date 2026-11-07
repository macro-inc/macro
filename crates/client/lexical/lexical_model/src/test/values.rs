use super::*;
use std::sync::Arc;
#[test]
fn portable_values_have_explicit_boundary_contracts() -> Result<(), Error> {
    let key = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 12,
    });
    assert_eq!(
        key.parts(),
        KeyParts {
            generation: 7,
            index: 12
        }
    );
    assert_eq!(key.generation(), 7);
    assert_eq!(key.index(), 12);
    let text = TextBuffer::new("abc");
    assert_eq!(text.as_str(), "abc");
    assert_eq!(text.byte_offset(Utf16Offset(2))?, 2);
    assert_eq!(text.code_unit_at(Utf16Offset(3)), None);
    assert_eq!(
        TextBuffer::new("").slice(Utf16Offset(0)..Utf16Offset(9))?,
        ""
    );
    assert_eq!(Utf16Offset(5).get(), 5);
    assert_eq!(
        Utf16Offset(5).checked_add(Utf16Offset(2)),
        Some(Utf16Offset(7))
    );
    assert_eq!(Utf16Offset(u32::MAX).checked_add(Utf16Offset(1)), None);
    assert_eq!(
        Utf16Offset(2).saturating_sub(Utf16Offset(5)),
        Utf16Offset(0)
    );
    assert_eq!(Utf16Offset(2) - Utf16Offset(5), Utf16Offset(0));
    assert_eq!(
        Utf16Offset(u32::MAX) + Utf16Offset(1),
        Utf16Offset(u32::MAX)
    );
    assert_eq!(Point::text(key, Utf16Offset(3)).offset(), 3);
    assert_eq!(Point::element(key, ChildIndex(4)).offset(), 4);
    assert_eq!(TextFormatType::Italic.flag(), TextFormat::ITALIC);
    assert!(TextFormat::BOLD.has(TextFormatType::Bold));
    assert_eq!(ElementFormat::Center.bits(), 2);
    assert_eq!(
        TextFormat::UPPERCASE.toggled(TextFormatType::Lowercase, None),
        TextFormat::LOWERCASE
    );
    let mut data = TextData::new("data");
    data.format = TextFormat::BOLD;
    data.detail = TextDetail::DIRECTIONLESS;
    assert!(data.is_directionless());
    assert!(!data.is_unmergeable());
    assert!(data.has_format(TextFormatType::Bold));
    assert_eq!(
        data.format_flags(TextFormatType::Italic, None),
        TextFormat::BOLD | TextFormat::ITALIC
    );
    assert!(!data.is_token());
    assert!(!data.is_segmented());
    data.mode = TextMode::Token;
    assert!(data.is_token());
    data.mode = TextMode::Segmented;
    assert!(data.is_segmented());
    Ok(())
}
#[test]
fn state_value_equality_uses_javascript_identity_and_number_rules() {
    assert!(true.js_equal(&true));
    assert_eq!(false.to_json(), serde_json::json!(false));
    assert!(12_i64.js_equal(&12));
    assert_eq!(12_i64.to_json(), serde_json::json!(12));
    assert!(3_u32.js_equal(&3));
    assert_eq!(3_u32.to_json(), serde_json::json!(3));
    assert!(Some("a".to_owned()).js_equal(&Some("a".to_owned())));
    assert_eq!(Option::<String>::None.to_json(), serde_json::Value::Null);
    assert!(f64::NAN.js_equal(&f64::NAN));
    assert!(!0.0_f64.js_equal(&-0.0));
    assert_eq!(2.0_f64.to_json(), serde_json::json!(2));
    let a: Arc<[String]> = vec!["a".into()].into();
    let b: Arc<[String]> = vec!["a".into()].into();
    assert!(a.js_equal(&a.clone()));
    assert!(!a.js_equal(&b));
    assert_eq!(a.to_json(), serde_json::json!(["a"]));
    let a = Arc::new(serde_json::json!({"x":1}));
    let b = Arc::new(serde_json::json!({"x":1}));
    assert!(!a.js_equal(&b));
    assert!(a.js_equal(&a.clone()));
    assert_eq!(a.to_json(), serde_json::json!({"x":1}));
    assert!(Arc::new(serde_json::json!(1)).js_equal(&Arc::new(serde_json::json!(1.0))));
}
#[test]
fn tags_deduplicate_in_first_insertion_order() {
    let mut tags = TagSet::from_tags([UpdateTag::Paste, UpdateTag::Paste]);
    assert!(!tags.insert(UpdateTag::Paste));
    assert!(tags.insert(UpdateTag::Custom("custom".into())));
    assert!(tags.contains(&UpdateTag::Paste));
    assert_eq!(
        tags.iter().cloned().collect::<Vec<_>>(),
        vec![UpdateTag::Paste, UpdateTag::Custom("custom".into())]
    );
    assert_eq!(UpdateTag::HistoryMerge.to_string(), "history-merge");
    assert_eq!(
        "custom".parse::<UpdateTag>().expect("tag"),
        UpdateTag::Custom("custom".into())
    );
}
#[test]
fn empty_raw_text_and_consecutive_separators_keep_tokens() {
    assert_eq!(tokenize_raw_text("").collect::<Vec<_>>(), vec![]);
    assert_eq!(
        tokenize_raw_text("\t\n\r\n").collect::<Vec<_>>(),
        vec![
            RawTextToken::Tab,
            RawTextToken::LineBreak,
            RawTextToken::LineBreak
        ]
    );
}
