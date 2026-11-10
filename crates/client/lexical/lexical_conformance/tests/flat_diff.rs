//! Native Rust producer versus the independent TypeScript boundary decoder.
#![cfg(not(target_arch = "wasm32"))]
use lexical_model::*;
use serde_json::{Value, json};
use std::{
    io::Write,
    process::{Command as Process, Stdio},
    sync::Arc,
};
fn decode(buffer: &DiffBuffer) -> Value {
    let mut child = Process::new("bun")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/tests/flat_diff/decoder.ts"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("Bun decoder");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(
            &serde_json::to_vec(&json!({"words":buffer.words,"strings":buffer.strings})).unwrap(),
        )
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(output.status.success());
    serde_json::from_slice(&output.stdout).unwrap()
}
#[test]
fn all_twelve_opcodes_decode_with_exact_utf8_offsets_and_json() {
    let editor = Editor::builder(EditorMode::Headless).build().unwrap();
    let one = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 1,
    });
    let two = NodeKey::from_parts(KeyParts {
        generation: 7,
        index: 2,
    });
    let props = ElementProps {
        format: ElementFormat::Right,
        indent: 3,
        direction: Some(TextDirection::Rtl),
        text_format: TextFormat::ITALIC,
        style: Arc::from("x: é"),
        text_style: Arc::from("font: 😀"),
    };
    let diff = Diff {
        generation: 7,
        full_reconcile: true,
        view_text_matches: Some(two),
        decorator_renders: vec![],
        ops: vec![
            DiffOp::Remove {
                key: one,
                subtree_root: true,
            },
            DiffOp::CreateElement {
                key: one,
                type_index: editor.registry().index_of::<Paragraph>().unwrap(),
                base: props.clone(),
                props: json!({"level":2}).as_object().unwrap().clone(),
            },
            DiffOp::CreateText {
                key: two,
                type_index: editor.registry().index_of::<Text>().unwrap(),
                text: "é😀".into(),
                base: TextProps {
                    format: TextFormat::BOLD,
                    mode: TextMode::Token,
                    detail: TextDetail::UNMERGEABLE,
                    style: Arc::from(""),
                },
                props: SerializedNode::new(),
            },
            DiffOp::CreateDecorator {
                key: one,
                type_index: editor.registry().index_of::<Artificial>().unwrap(),
                props: json!({"label":"世界"}).as_object().unwrap().clone(),
            },
            DiffOp::CreateLineBreak {
                key: two,
                type_index: editor.registry().index_of::<LineBreak>().unwrap(),
            },
            DiffOp::Children {
                parent: NodeKey::ROOT,
                children: vec![one, two],
            },
            DiffOp::Text {
                key: two,
                text: "new 😀".into(),
            },
            DiffOp::TextProps {
                key: two,
                props: TextProps {
                    format: TextFormat::ITALIC,
                    mode: TextMode::Segmented,
                    detail: TextDetail::DIRECTIONLESS,
                    style: Arc::from("color: red"),
                },
            },
            DiffOp::ElementProps { key: one, props },
            DiffOp::NodeProps {
                key: one,
                props: SerializedNode::new(),
            },
            DiffOp::State {
                key: two,
                state: None,
            },
            DiffOp::State {
                key: one,
                state: Some(SerializedNode::new()),
            },
            DiffOp::SetDecoratorRevision {
                key: one,
                revision: (1u64 << 53) + 9,
            },
        ],
    };
    let mut buffer = DiffBuffer::default();
    diff.encode(&mut buffer);
    let expected = json!({"formatVersion":1,"generation":7,"fullReconcile":true,"viewTextMatches":2,"ops":[
        {"opcode":1,"key":1,"subtreeRoot":true},
        {"opcode":2,"key":1,"type":4,"format":3,"indent":3,"direction":2,"textFormat":2,"style":"x: é","textStyle":"font: 😀","props":{"level":2}},
        {"opcode":3,"key":2,"type":1,"format":1,"mode":1,"detail":2,"text":"é😀","style":"","props":{}},
        {"opcode":4,"key":1,"type":5,"props":{"label":"世界"}},
        {"opcode":5,"key":2,"type":2},
        {"opcode":6,"parent":0,"children":[1,2]},
        {"opcode":7,"key":2,"text":"new 😀"},
        {"opcode":8,"key":2,"format":2,"mode":2,"detail":1,"style":"color: red"},
        {"opcode":9,"key":1,"format":3,"indent":3,"direction":2,"textFormat":2,"style":"x: é","textStyle":"font: 😀"},
        {"opcode":10,"key":1,"props":{}},
        {"opcode":11,"key":2,"state":null},
        {"opcode":11,"key":1,"state":{}},
        {"opcode":12,"key":1,"revisionLo":9,"revisionHi":2097152}
    ]});
    assert_eq!(decode(&buffer), json!({"ok":true,"value":expected}));
    let original = buffer.clone();
    diff.encode(&mut buffer);
    assert_eq!(buffer, original);
}
#[test]
fn decoder_rejects_unknown_version_opcode_flags_invalid_booleans_and_ranges() {
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![2, 0, 0, DIFF_NONE, 0],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 2, DIFF_NONE, 0],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 99],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 1, 0, 2],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 7, 1, 2, 3],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 7, 1, 0, 1],
            strings: vec![0xff]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 6, 0, 100],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 0, 0],
            strings: vec![]
        })["ok"],
        false
    );
    assert_eq!(
        decode(&DiffBuffer {
            words: vec![1, 0, 0, DIFF_NONE, 1, 10, 1, 0, 2],
            strings: b"[]".to_vec()
        })["ok"],
        false
    );
}
