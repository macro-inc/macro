use anyhow::Context;
use models_search::document::MarkdownParseResult;

/// Takes the raw json markdown file and parses it into searchable content for opensearch.
/// NOTE: this is included for legacy reasons for files included with DSS and should
/// be deprecated
pub fn parse_markdown_legacy(content: &str) -> anyhow::Result<Vec<MarkdownParseResult>> {
    tracing::trace!("parsing markdown");

    if content.is_empty() {
        tracing::trace!("markdown is empty");
        return Ok([].into());
    }

    let markdown: serde_json::Value = match serde_json::from_str(content) {
        Ok(markdown) => markdown,
        Err(_) => {
            tracing::trace!("unable to parse markdown");
            return Ok([].into());
        }
    };

    let mut results: Vec<MarkdownParseResult> = Vec::new();

    if let Some(root) = markdown.get("root") {
        let root_obj = root.as_object().context("expected root to be an object")?;
        if let Some(children) = root_obj.get("children") {
            let children = children
                .as_array()
                .context("expected children to be an array")?;

            for child in children {
                let child_obj = child
                    .as_object()
                    .context("expected child to be an object")?;
                if let Some(search_object) = child_obj.get("$") {
                    let search_object = search_object
                        .as_object()
                        .context("expected search object to be an object")?;
                    if let Some(id) = search_object.get("id") {
                        let id = id.as_str().context("expected id to be a string")?;
                        if let Some(search_text) = search_object.get("searchText") {
                            let search_text = search_text
                                .as_str()
                                .context("expected searchText to be a string")?;
                            results.push(MarkdownParseResult {
                                node_id: id.to_string(),
                                content: search_text.to_string(),
                                raw_content: child.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_markdown() -> anyhow::Result<()> {
        let content = std::fs::read_to_string("./fixtures/markdown_example.md")?;

        let results = parse_markdown_legacy(&content)?;

        assert_eq!(results.len(), 14);

        let expected_raw_content = serde_json::json!({
        "children": [
          {
            "type": "equation",
            "version": 1,
            "$": {
              "id": "AMxKT8Fn"
            },
            "equation": "a^2=b^2+c^2",
            "inline": true
          }
        ],
        "direction": null,
        "format": "",
        "indent": 0,
        "type": "paragraph",
        "version": 1,
        "$": {
          "id": "22yctGbM",
          "searchText": "a^2=b^2+c^2"
        },
        "textFormat": 0,
        "textStyle": ""

        });

        assert_eq!(results[0].node_id, "22yctGbM");
        assert_eq!(results[0].content, "a^2=b^2+c^2");
        assert_eq!(results[0].raw_content, expected_raw_content.to_string());

        Ok(())
    }
}
