//! read_back_storage_nulls reads a creator's export as a Source importer holds it:
//! an absent storage-null key becomes null, and the policy's declared stored-normalized
//! fields take Source's import values; every other present value is unchanged.
use super::*;

struct TablePolicy;
impl SyncPolicy for TablePolicy {
    fn stored_normalized_fields(&self, node_type: &str) -> &'static [&'static str] {
        if node_type == "table" {
            &["rowStriping"]
        } else {
            &[]
        }
    }
    // Source's `|| undefined` import of a falsy rowStriping.
    fn normalize_stored(
        &self,
        node: &mut SerializedNode,
        _: &mut dyn FnMut() -> Result<Option<SerializedNode>>,
    ) -> Result<()> {
        if node.get("type").and_then(serde_json::Value::as_str) == Some("table")
            && matches!(
                node.get("rowStriping"),
                Some(serde_json::Value::Null | serde_json::Value::Bool(false))
            )
        {
            node.remove("rowStriping");
        }
        Ok(())
    }
    fn is_dropped(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_transparent(&self, _: StateRef<'_>, _: NodeKey) -> bool {
        false
    }
    fn is_dropped_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn is_transparent_json(&self, _: &SerializedNode) -> bool {
        false
    }
    fn local_state_keys(&self) -> &'static [&'static str] {
        &[]
    }
    fn ignore_in_remote_compare(&self, _: &str, _: &SerializedNode) -> &'static [&'static str] {
        &[]
    }
    fn keep_local_on_remote(&self, _: &str) -> &'static [&'static str] {
        &[]
    }
    fn comparison_kind(&self, node_type: &str) -> ComparisonKind {
        match node_type {
            "text" => ComparisonKind::Text,
            "paragraph" => ComparisonKind::Paragraph,
            _ => ComparisonKind::Exact,
        }
    }
    fn own_undefined_fields(&self, node_type: &str) -> &[String] {
        static TABLE: std::sync::LazyLock<Vec<String>> =
            std::sync::LazyLock::new(|| vec!["colWidths".to_owned(), "rowStriping".to_owned()]);
        if node_type == "table" { &TABLE } else { &[] }
    }
}

#[test]
fn an_absent_listed_table_key_reads_back_as_null() {
    let mut node = json!({"type": "table", "version": 1, "children": []});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    assert_eq!(
        node,
        json!({"type": "table", "version": 1, "colWidths": null, "children": []})
    );
}

#[test]
fn a_present_listed_value_is_kept_exactly() {
    let mut node = json!({"type": "table", "version": 1, "colWidths": [120, 80], "children": []});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    assert_eq!(
        node,
        json!({"type": "table", "version": 1, "colWidths": [120, 80], "children": []})
    );
}

#[test]
fn an_unlisted_absent_key_stays_absent() {
    let mut node = json!({"type": "tablecell", "version": 1, "children": []});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    assert_eq!(
        node,
        json!({"type": "tablecell", "version": 1, "children": []})
    );
}

#[test]
fn builtin_text_and_paragraph_keys_and_nested_children_are_read_back() {
    let mut node = json!({"type": "root", "children": [
        {"type": "paragraph", "format": "", "children": [
            {"type": "text", "text": "a", "format": 1},
        ]},
        {"type": "table", "children": []},
    ]});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    assert_eq!(
        node,
        json!({"type": "root", "children": [
            {"type": "paragraph", "format": "", "direction": null, "indent": null,
                "textFormat": null, "textStyle": null, "children": [
                {"type": "text", "text": "a", "format": 1, "detail": null, "mode": null,
                    "style": null},
            ]},
            {"type": "table", "colWidths": null, "children": []},
        ]})
    );
}

#[test]
fn a_key_the_import_normalizes_away_stays_absent() {
    let mut node = json!({"type": "table", "version": 1, "children": []});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    // Stored null, then Source's `|| undefined` import: rowStriping reads back absent.
    assert_eq!(
        node,
        json!({"type": "table", "version": 1, "colWidths": null, "children": []})
    );
}

#[test]
fn a_present_normalized_value_is_kept() {
    let mut node = json!({"type": "table", "rowStriping": true, "children": []});
    read_back_storage_nulls(&mut node, &TablePolicy).expect("read back");
    assert_eq!(
        node,
        json!({"type": "table", "rowStriping": true, "colWidths": null, "children": []})
    );
}
