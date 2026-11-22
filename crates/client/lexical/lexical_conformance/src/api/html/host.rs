//! DOM transport only: the product's JS builder and jsdom own HTML serialization.
use crate::replay::*;
use lexical_html::HtmlNode;
use serde_json::{Value, json};

const ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../..");

pub(super) fn serialize(nodes: &[HtmlNode]) -> Result<String> {
    let data = serde_json::to_string(&nodes.iter().map(message).collect::<Vec<_>>())?;
    serialize_host(ROOT, &data)
}

// Match the product clipboardDom wire fields. No node, selection or DOM policy
// lives here: attributes retain their native property/style construction facts.
fn message(node: &HtmlNode) -> Value {
    match node {
        HtmlNode::Element(element) => json!({
            "kind": 0, "tag": element.tag, "text": "",
            "attributes": element.dom_construction().map(|(name,value,styles,property)| json!({
                "name": name, "value": value, "property": property,
                "styles": styles.iter().map(|(name,value)| json!({"name":name,"value":value})).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
            "children": element.children.iter().map(message).collect::<Vec<_>>(),
        }),
        HtmlNode::Text(text) => json!({"kind":1,"text":text}),
        HtmlNode::Fragment(children) => {
            json!({"kind":2,"children":children.iter().map(message).collect::<Vec<_>>()})
        }
        HtmlNode::Raw(text) => json!({"kind":3,"text":text}),
    }
}

#[cfg(not(target_arch = "wasm32"))]
fn serialize_host(root: &str, nodes: &str) -> Result<String> {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    // Without --no-install, Bun auto-installs a missing jsdom from the registry,
    // unpinned and racing across concurrent cases, instead of failing.
    let mut child = Command::new("bun")
        .arg("--no-install")
        .arg(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/api/html/host.mjs"
        ))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    child
        .stdin
        .take()
        .ok_or_else(|| fail("HTML host stdin"))?
        .write_all(serde_json::to_string(&json!({"root":root,"nodes":nodes}))?.as_bytes())?;
    let output = child.wait_with_output()?;
    if !output.status.success() {
        return Err(fail(format!(
            "HTML DOM host (needs `bun install --cwd packages/lexical-conformance`): {}",
            String::from_utf8_lossy(&output.stderr)
        )));
    }
    String::from_utf8(output.stdout).map_err(|error| fail(format!("HTML host output: {error}")))
}

#[cfg(all(target_arch = "wasm32", feature = "node-dom"))]
fn serialize_host(root: &str, nodes: &str) -> Result<String> {
    #[wasm_bindgen::prelude::wasm_bindgen(module = "/src/api/html/host.mjs")]
    extern "C" {
        #[wasm_bindgen(catch, js_name = serializeHtml)]
        fn render(root: &str, nodes: &str) -> std::result::Result<String, wasm_bindgen::JsValue>;
    }
    render(root, nodes).map_err(|error| fail(format!("HTML DOM host: {error:?}")))
}

#[cfg(all(target_arch = "wasm32", not(feature = "node-dom")))]
fn serialize_host(_root: &str, _nodes: &str) -> Result<String> {
    Err(fail(
        "HTML fixture replay requires the development node-dom feature",
    ))
}
