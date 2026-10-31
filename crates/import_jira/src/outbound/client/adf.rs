//! Preserve ADF text, structure and links as markdown. Unknown containers keep
//! their descendants; unsupported leaf nodes are visible rather than dropped.

use serde_json::Value;

pub(super) fn markdown(node: &Value) -> String {
    render(node, 0).trim().to_string()
}

fn render(node: &Value, depth: usize) -> String {
    if depth > 64 {
        return "[ADF nesting limit]".into();
    }
    if let Some(text) = node.as_str() {
        return text.to_string();
    }
    if node.is_null() {
        return String::new();
    }
    let content = node
        .get("content")
        .and_then(Value::as_array)
        .map(|children| {
            children
                .iter()
                .map(|child| render(child, depth + 1))
                .collect::<String>()
        })
        .unwrap_or_default();
    let attr = |name: &str| {
        node.get("attrs")
            .and_then(|attrs| attrs.get(name))
            .and_then(Value::as_str)
            .unwrap_or("")
    };
    match node.get("type").and_then(Value::as_str).unwrap_or("") {
        "doc" => content,
        "text" => {
            let mut text = node
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if let Some(marks) = node.get("marks").and_then(Value::as_array) {
                for mark in marks {
                    text = match mark.get("type").and_then(Value::as_str) {
                        Some("strong") => format!("**{text}**"),
                        Some("em") => format!("*{text}*"),
                        Some("strike") => format!("~~{text}~~"),
                        Some("code") => format!("`{text}`"),
                        Some("link") => format!(
                            "[{text}]({})",
                            mark.pointer("/attrs/href")
                                .and_then(Value::as_str)
                                .unwrap_or("")
                        ),
                        _ => text,
                    };
                }
            }
            text
        }
        "paragraph" => format!("{content}\n\n"),
        "heading" => format!(
            "{} {content}\n\n",
            "#".repeat(
                node.pointer("/attrs/level")
                    .and_then(Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, 6) as usize
            )
        ),
        "hardBreak" => "\n".into(),
        "rule" => "\n---\n\n".into(),
        "codeBlock" => format!("\n```{}\n{}\n```\n\n", attr("language"), content.trim_end()),
        "blockquote" => format!(
            "{}\n\n",
            content
                .trim()
                .lines()
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n")
        ),
        "bulletList" | "orderedList" => {
            let ordered = node["type"] == "orderedList";
            let start = node
                .pointer("/attrs/order")
                .and_then(Value::as_u64)
                .unwrap_or(1);
            let items = node
                .get("content")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .enumerate()
                        .map(|(i, item)| {
                            let body = render(item, depth + 1);
                            let marker = if ordered {
                                format!("{}.", start + i as u64)
                            } else {
                                "-".into()
                            };
                            let indent = " ".repeat(marker.len() + 1);
                            format!(
                                "{marker} {}\n",
                                body.trim().replace('\n', &format!("\n{indent}"))
                            )
                        })
                        .collect::<String>()
                })
                .unwrap_or_default();
            format!("{items}\n")
        }
        "listItem" | "panel" | "table" | "tableRow" | "tableCell" | "tableHeader" => content,
        "mention" => format!("@{}", attr("text").trim_start_matches('@')),
        "inlineCard" | "blockCard" => format!("[{}]({})", attr("url"), attr("url")),
        "emoji" => attr("shortName").to_string(),
        "status" => attr("text").to_string(),
        "media" => format!("[Jira attachment: {}]", attr("id")),
        kind if content.is_empty() => format!("[Unsupported Jira content: {kind}]"),
        _ => content,
    }
}

#[cfg(test)]
mod test;
