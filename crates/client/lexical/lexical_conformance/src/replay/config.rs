//! Validate recorder editor configuration without accepting unknown host fields.
use super::{Result, fail, string};
use serde_json::{Value, json};

pub(super) fn validate_config(config: &Value) -> Result<()> {
    let object = config
        .as_object()
        .ok_or_else(|| fail("missing editor config"))?;
    for key in object.keys() {
        if ![
            "namespace",
            "namespaceGenerated",
            "nodeClasses",
            "headless",
            "nodes",
            "replacements",
            "plugins",
            "theme",
            "editable",
            "rootElement",
        ]
        .contains(&key.as_str())
        {
            return Err(fail(format!("unsupported config field {key}")));
        }
    }
    string(&config["namespace"])?;
    for field in ["namespaceGenerated", "headless"] {
        if config.get(field).is_some_and(|value| !value.is_boolean()) {
            return Err(fail(format!("invalid editor config {field}")));
        }
    }
    if let Some(classes) = config.get("nodeClasses") {
        for (kind, value) in classes
            .as_object()
            .ok_or_else(|| fail("invalid nodeClasses"))?
        {
            if !config["nodes"]
                .as_array()
                .is_some_and(|nodes| nodes.contains(&json!(kind)))
                || value.as_object().is_none_or(|value| value.len() != 1)
                || !value["$fn"].is_string()
            {
                return Err(fail(format!("invalid configured class metadata {kind}")));
            }
        }
    }
    if !config["editable"].is_boolean() || !config["rootElement"].is_boolean() {
        return Err(fail("invalid editor host config"));
    }
    if !config["replacements"].as_array().is_some_and(Vec::is_empty)
        || !config["plugins"].as_array().is_some_and(Vec::is_empty)
    {
        return Err(fail("unimplemented configured replacement/plugin"));
    }
    for node in config["nodes"]
        .as_array()
        .ok_or_else(|| fail("missing configured nodes"))?
    {
        if ![
            "root",
            "text",
            "linebreak",
            "tab",
            "paragraph",
            "artificial",
            "heading",
            "list",
            "listitem",
            "quote",
            "code",
            "table",
            "tablecell",
            "tablerow",
            "hashtag",
            "code-highlight",
            "autolink",
            "link",
            "overflow",
            "test_block",
            "test_segmented",
            "test_exclude_from_copy_block",
            "test_decorator",
            "test_inline_block",
            "test_shadow_root",
            "test_text",
            "mark",
        ]
        .contains(&string(node)?)
        {
            return Err(fail(format!("unimplemented configured class {node}")));
        }
    }
    // Theme, namespace, editability and root attachment are host inputs. The
    // interpreter executes no DOM path; view APIs fail rather than using a fake.
    Ok(())
}
