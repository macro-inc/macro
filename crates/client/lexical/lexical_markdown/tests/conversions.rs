//! Independent upstream md ↔ JSON table, including export trees imported from HTML.
#[path = "conversions/transformers.rs"]
mod transformers;
use lexical_markdown::*;
use lexical_model::*;
use lexical_rich_nodes::{
    code::register_code_nodes, heading::HeadingNode, link::LinkNode,
    list::register::register_list_nodes, quote::QuoteNode,
};
use libtest_mimic::{Arguments, Trial};
use serde_json::Value;
fn main() {
    let args = Arguments::from_args();
    let fixture: Value =
        serde_json::from_str(include_str!("fixtures/conversions-v045.json")).expect("oracle");
    let rows = fixture["rows"].as_array().expect("rows");
    assert_eq!(rows.len(), 111);
    let mut trials = Vec::new();
    for row in rows {
        for direction in ["import", "selection", "export"] {
            if row[if direction == "export" {
                "skipExport"
            } else {
                "skipImport"
            }]
            .as_bool()
                == Some(true)
            {
                continue;
            }
            let row = row.clone();
            let name = format!(
                "upstream::row{:03}::{direction}::{}",
                row["index"].as_u64().expect("index"),
                row["md"].as_str().expect("markdown").replace('\n', "\\n")
            );
            trials.push(Trial::test(name, move || {
                run(&row, direction).map_err(Into::into)
            }));
        }
    }
    assert_eq!(
        trials.len(),
        fixture["expanded"].as_u64().expect("count") as usize
    );
    libtest_mimic::run(&args, trials).exit();
}
fn run(row: &Value, direction: &str) -> std::result::Result<(), String> {
    let mut editor = register_list_nodes(register_code_nodes(
        Editor::builder(EditorMode::Headless)
            .node::<HeadingNode>()
            .node::<QuoteNode>()
            .node::<LinkNode>(),
    ))
    .build()
    .map_err(|e| e.to_string())?;
    let opts = MarkdownOptions {
        should_preserve_new_lines: row["preserve"] == true,
        should_merge_adjacent_lines: row["merge"] == true,
        ..Default::default()
    };
    let t = transformers::registry(row, direction != "export");
    if direction == "export" {
        let input =
            serde_json::from_value(row["exportInput"].clone()).map_err(|e| e.to_string())?;
        let state = editor
            .parse_editor_state(&input)
            .map_err(|e| e.to_string())?;
        let actual =
            convert_to_markdown_string(&state, &t, None, &opts).map_err(|e| e.to_string())?;
        if actual != row["exported"] {
            return Err(format!("export: {actual:?}\nexpected: {}", row["exported"]));
        }
    } else {
        let mut tx = editor.transaction();
        convert_from_markdown_string(
            &mut tx,
            row["md"].as_str().expect("markdown"),
            &t,
            None,
            &opts,
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        if direction == "selection" {
            assert!(row["selection"].is_null());
            if editor.state().selection().is_some() {
                return Err("import selected content".into());
            }
        } else {
            let actual = serde_json::to_value(editor.state().to_json().map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
            if actual != row["imported"] {
                return Err(format!("JSON: {actual}\nexpected: {}", row["imported"]));
            }
        }
    }
    Ok(())
}
