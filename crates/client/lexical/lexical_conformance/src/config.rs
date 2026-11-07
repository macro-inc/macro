//! Strict editor configuration decoding, including recorder provenance metadata.
use crate::replay::{Result, fail, string};
use serde_json::Value;
pub(crate) fn validate_config(config: &Value) -> Result<()> {
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
    for key in ["namespaceGenerated", "headless"] {
        if config.get(key).is_some_and(|value| !value.is_boolean()) {
            return Err(fail(format!("invalid editor config {key}")));
        }
    }
    if config["headless"] == true && config["rootElement"] == true {
        return Err(fail("headless editor cannot have an attached root"));
    }
    if let Some(classes) = config.get("nodeClasses") {
        let classes = classes
            .as_object()
            .ok_or_else(|| fail("invalid nodeClasses"))?;
        for (kind, reference) in classes {
            let expected = match kind.as_str() {
                "root" => "RootNode",
                "paragraph" => "ParagraphNode",
                "text" => "TextNode",
                "linebreak" => "LineBreakNode",
                "tab" => "TabNode",
                "artificial" => "ArtificialNode__DO_NOT_USE",
                "heading" => "HeadingNode",
                "quote" => "QuoteNode",
                "code" => "CodeNode",
                "code-highlight" => "CodeHighlightNode",
                "hashtag" => "HashtagNode",
                "list" => "ListNode",
                "listitem" => "ListItemNode",
                "link" => "LinkNode",
                "autolink" => "AutoLinkNode",
                "mark" => "MarkNode",
                "overflow" => "OverflowNode",
                "table" => "TableNode",
                "tablerow" => "TableRowNode",
                "tablecell" => "TableCellNode",
                _ => {
                    return Err(fail(format!(
                        "unsupported configured class reference {kind}"
                    )));
                }
            };
            let symbol = string(&reference["$fn"])?;
            let (module, name) = symbol
                .rsplit_once('.')
                .ok_or_else(|| fail("invalid class reference"))?;
            let module_matches = match kind.as_str() {
                "root" | "paragraph" | "text" | "linebreak" | "tab" | "artificial" => {
                    module == "lexical"
                }
                "heading" | "quote" => module == "@lexical/rich-text",
                "code" | "code-highlight" => {
                    matches!(module, "@lexical/code" | "@lexical/code-core")
                }
                "hashtag" => module == "@lexical/hashtag",
                "list" | "listitem" => module == "@lexical/list",
                "link" | "autolink" => module == "@lexical/link",
                "mark" => module == "@lexical/mark",
                "overflow" => module == "@lexical/overflow",
                "table" | "tablerow" | "tablecell" => module == "@lexical/table",
                _ => false,
            };
            // Recorder names constructors by their first exported graph path.
            let transformer_alias = match kind.as_str() {
                "heading" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.0.dependencies.0")
                }
                "quote" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.1.dependencies.0")
                }
                "list" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.2.dependencies.0")
                }
                "listitem" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.2.dependencies.1")
                }
                "code" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.4.dependencies.0")
                }
                "link" => {
                    Some("@lexical/markdown/MarkdownTransformers.TRANSFORMERS.14.dependencies.0")
                }
                _ => None,
            };
            if (!(module_matches && name == expected) && transformer_alias != Some(symbol))
                || reference.as_object().is_none_or(|object| object.len() != 1)
                || !config["nodes"]
                    .as_array()
                    .is_some_and(|nodes| nodes.contains(&Value::String(kind.clone())))
            {
                return Err(fail(format!(
                    "unsupported configured class reference {kind}: {symbol}"
                )));
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
