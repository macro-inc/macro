//! String-level mention projections shared by previews, search and embeddings.
use crate::nodes::{parse_database_query_json, parse_date_mention_body};
use base64::{
    Engine, alphabet,
    engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig},
};
use lexical_model::{js_string, js_trim, js_truthy};
use lexical_rich_nodes::utils::matcher::{Match, RegexMatcher};
use serde_json::Value;
fn replace(text: &str, source: &str, flags: &str, render: impl Fn(&Match) -> String) -> String {
    let regex = RegexMatcher::new(source, flags).expect("source tag parser expression");
    let units: Vec<_> = text.encode_utf16().collect();
    let mut cursor = 0;
    let mut output = String::new();
    for m in regex.find_all(text) {
        output.push_str(&String::from_utf16_lossy(
            units
                .get(cursor..m.index.get() as usize)
                .expect("ordered matcher offsets"),
        ));
        output.push_str(&render(&m));
        cursor = m.end().get() as usize;
    }
    output.push_str(&String::from_utf16_lossy(
        units.get(cursor..).expect("matcher endpoint in source"),
    ));
    output
}
fn tag(text: &str, name: &str, dotall: bool, render: impl Fn(&Value) -> String) -> String {
    replace(
        text,
        &format!("<{name}>(.*?)</{name}>"),
        if dotall { "s" } else { "" },
        |m| {
            serde_json::from_str::<Value>(m.get(1).unwrap_or(""))
                .map(|v| render(&v))
                .unwrap_or_default()
        },
    )
}
fn field<'a>(data: &'a Value, key: &str) -> Option<&'a Value> {
    data.get(key).filter(|v| js_truthy(v))
}
fn label(data: &Value, keys: &[&str]) -> String {
    keys.iter()
        .find_map(|key| field(data, key))
        .map(js_string)
        .unwrap_or_default()
}
fn user_display(data: &Value) -> String {
    if let Some(display) = field(data, "displayName") {
        return js_string(display);
    }
    data.get("email")
        .and_then(Value::as_str)
        .map(|email| {
            email
                .split('@')
                .next()
                .filter(|s| !s.is_empty())
                .unwrap_or(email)
                .into()
        })
        .unwrap_or_default()
}
/// User mention display labels, falling back to the local email part.
pub fn parse_user_mentions(text: &str) -> String {
    tag(text, "m-user-mention", false, user_display)
}
/// User mention text as stored in the backend search index.
pub fn parse_user_mentions_for_search(text: &str) -> String {
    tag(text, "m-user-mention", false, |data| {
        let id = data.get("userId").and_then(Value::as_str).unwrap_or("");
        if id.starts_with("bot|") {
            let name = label(data, &["displayName", "email"]);
            if name.is_empty() { "Bot".into() } else { name }
        } else if let Some(id) = id.strip_prefix("macro|") {
            if id.is_empty() {
                "Guest".into()
            } else {
                id.into()
            }
        } else {
            "Guest".into()
        }
    })
}
/// Contact mention labels.
pub fn parse_contact_mentions(text: &str) -> String {
    tag(text, "m-contact-mention", false, |v| {
        label(v, &["name", "emailOrDomain"])
    })
}
/// Date mention labels, including bare ISO bodies.
pub fn parse_date_mentions(text: &str) -> String {
    replace(text, "<m-date-mention>(.*?)</m-date-mention>", "", |m| {
        let body = m.get(1).unwrap_or("");
        if !js_trim(body).starts_with('{') {
            return parse_date_mention_body(body)
                .and_then(|data| data.display_format.as_deref().map(str::to_owned))
                .unwrap_or_default();
        }
        serde_json::from_str::<Value>(body)
            .map(|data| label(&data, &["displayFormat"]))
            .unwrap_or_default()
    })
}
/// Cached document names.
pub fn parse_document_mentions(text: &str) -> String {
    tag(text, "m-document-mention", false, |v| {
        label(v, &["documentName"])
    })
}
/// Cached session labels, falling back to their identifiers.
pub fn parse_agent_session_mentions(text: &str) -> String {
    tag(text, "m-agent-session-mention", false, |v| {
        v.get("label")
            .and_then(Value::as_str)
            .or_else(|| v.get("id").and_then(Value::as_str))
            .unwrap_or("")
            .into()
    })
}
fn github_ref(url: &str) -> Option<String> {
    use lexical_rich_nodes::utils::matcher::Matcher;
    let m = RegexMatcher::new(
        r"github\.com/([A-Za-z0-9-]+)/([A-Za-z0-9._-]+)/pull/([1-9][0-9]*)",
        "",
    )
    .expect("source PR reference expression")
    .exec(url)?;
    Some(format!("{}/{}#{}", m.get(1)?, m.get(2)?, m.get(3)?))
}
/// Pull request labels, identifiers, or a compact repository reference.
pub fn parse_pull_request_mentions(text: &str) -> String {
    tag(text, "m-pr-mention", false, |v| {
        let value = label(v, &["label", "id"]);
        if !value.is_empty() {
            value
        } else {
            v.get("url")
                .and_then(Value::as_str)
                .and_then(github_ref)
                .unwrap_or_default()
        }
    })
}
/// Account-manager requests have a fixed visible description.
pub fn parse_account_manager_requests(text: &str) -> String {
    replace(
        text,
        "<m-account-manager-request>.*?</m-account-manager-request>",
        "",
        |_| "Account manager request".into(),
    )
}
/// Connection chip call-to-action text.
pub fn parse_connect_apps(text: &str) -> String {
    tag(text, "m-connect-app", false, |v| {
        v.get("name")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(|name| format!("Connect {name}"))
            .unwrap_or_default()
    })
}
/// Validated saved-query labels, retaining a generic unavailable label.
pub fn parse_database_queries(text: &str) -> String {
    replace(text, "<m-db-query>(.*?)</m-db-query>", "", |m| {
        parse_database_query_json(m.get(1).unwrap_or(""))
            .map(|data| data.title.filter(|s| !s.is_empty()).unwrap_or(data.prompt))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "Live database answer".into())
    })
}
/// Activity steps are omitted from prose previews.
pub fn parse_agent_activities(text: &str) -> String {
    replace(
        text,
        r"<m-agent-activity>.*?</m-agent-activity>(?:\r?\n)*",
        "s",
        |_| String::new(),
    )
}
/// Notification summary bodies.
pub fn parse_cursor_system_notifications(text: &str) -> String {
    replace(
        text,
        r"<system_notification\b[^>]*>(.*?)</system_notification>",
        "s",
        |m| js_trim(m.get(1).unwrap_or("")).into(),
    )
}
/// Human-readable tag names.
pub fn parse_tag_mentions(text: &str) -> String {
    tag(text, "m-tag", false, |v| {
        field(v, "name")
            .map(|name| format!("#{}", js_string(name)))
            .unwrap_or_default()
    })
}
/// Internal link display text, falling back to the URL.
pub fn parse_links(text: &str) -> String {
    tag(text, "m-link", false, |v| label(v, &["text", "url"]))
}
/// Authored group labels, including a bare at sign for absent aliases.
pub fn parse_group_mentions(text: &str) -> String {
    tag(text, "m-group-mention", false, |v| {
        format!("@{}", label(v, &["groupAlias"]))
    })
}
/// Document-card cached names.
pub fn parse_document_cards(text: &str) -> String {
    tag(text, "m-document-card", false, |v| {
        label(v, &["documentName"])
    })
}
/// Reply preview text.
pub fn parse_reply_targets(text: &str) -> String {
    tag(text, "m-reply-target", true, |v| label(v, &["displayText"]))
}
fn snapshot(encoded: &str) -> Option<Value> {
    if encoded.starts_with('{') {
        serde_json::from_str(encoded).ok()
    } else {
        let encoded: String = encoded
            .chars()
            .filter(|c| !matches!(c, '\t' | '\n' | '\u{c}' | '\r' | ' '))
            .collect();
        let engine = GeneralPurpose::new(
            &alphabet::STANDARD,
            GeneralPurposeConfig::new()
                .with_decode_padding_mode(DecodePaddingMode::Indifferent)
                .with_decode_allow_trailing_bits(true),
        );
        let bytes = engine.decode(encoded).ok()?;
        serde_json::from_str(&String::from_utf8_lossy(&bytes)).ok()
    }
}
/// Snapshot names, accepting raw JSON and legacy base64 JSON bodies.
pub fn parse_snapshots(text: &str) -> String {
    replace(text, "<m-snapshot>(.*?)</m-snapshot>", "", |m| {
        snapshot(m.get(1).unwrap_or(""))
            .map(|v| label(&v, &["documentName"]))
            .unwrap_or_default()
    })
}
/// Strip one valid leading private context envelope, leaving user-authored tags visible.
pub fn strip_agent_context(text: &str) -> String {
    use lexical_rich_nodes::utils::matcher::Matcher;
    let regex = RegexMatcher::new(
        r"^<m-agent-context>(.*?)</m-agent-context>(?:\r?\n\r?\n)?",
        "s",
    )
    .expect("source context prefix expression");
    let Some(m) = regex.exec(text) else {
        return text.into();
    };
    let value = serde_json::from_str::<Value>(m.get(1).unwrap_or(""));
    if value.ok().is_some_and(|v| {
        v.as_object().is_some_and(|v| v.len() == 2)
            && v.get("version") == Some(&Value::from(1))
            && v.get("text").is_some_and(Value::is_string)
    }) {
        text.strip_prefix(m.full()).unwrap_or(text).into()
    } else {
        text.into()
    }
}
fn flatten(markdown: &str, user: fn(&str) -> String) -> String {
    let mut text = markdown.to_owned();
    for transform in [
        parse_agent_activities,
        user,
        parse_contact_mentions,
        parse_date_mentions,
        parse_group_mentions,
        parse_document_mentions,
        parse_pull_request_mentions,
        parse_agent_session_mentions,
        parse_tag_mentions,
        parse_connect_apps,
        parse_account_manager_requests,
        parse_cursor_system_notifications,
        parse_database_queries,
        parse_snapshots,
        parse_document_cards,
        parse_links,
        parse_reply_targets,
        strip_agent_context,
    ] {
        text = transform(&text);
    }
    text
}
/// Preview text with display labels for user mentions.
pub fn markdown_to_plain_text(markdown: &str) -> String {
    flatten(markdown, parse_user_mentions)
}
/// Search text with backend principal labels for user mentions.
pub fn markdown_to_search_text(markdown: &str) -> String {
    flatten(markdown, parse_user_mentions_for_search)
}
/// Flatten existing quote markers and protect reserved private-context tag syntax.
pub fn quote_markdown(content: &str) -> Option<String> {
    let content = content
        .replace("<m-agent-context>", "&lt;m-agent-context>")
        .replace("</m-agent-context>", "&lt;/m-agent-context>");
    let lines = js_trim(&content)
        .split('\n')
        .map(|line| replace(line, r"^\s*>+\s?", "", |_| String::new()))
        .collect::<Vec<_>>()
        .join("\n");
    let lines = js_trim(&lines);
    if lines.is_empty() {
        None
    } else {
        Some(
            lines
                .split('\n')
                .map(|line| format!("> {line}"))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    }
}

fn document_ref(data: &Value) -> String {
    let name = label(data, &["documentName"]);
    let Some(id) = field(data, "documentId") else {
        return name;
    };
    let kind = field(data, "blockName")
        .map(js_string)
        .unwrap_or_else(|| "document".into());
    let suffix = data
        .get("blockParams")
        .and_then(|params| field(params, "channel_message_id"))
        .map(|id| format!("#{}", js_string(id)))
        .unwrap_or_default();
    format!("[{name}]({kind}:{}{suffix})", js_string(id))
}
fn flatten_tables(text: &str) -> String {
    replace(
        text,
        r"<m-table(?:\s[^>]*)?>(.*?)</m-table>",
        "s",
        |table| {
            let rows = RegexMatcher::new(r"<m-table-row(?:\s[^>]*)?>(.*?)</m-table-row>", "s")
                .expect("source table row expression");
            let cells = RegexMatcher::new(r"<m-table-cell(?:\s[^>]*)?>(.*?)</m-table-cell>", "s")
                .expect("source table cell expression");
            rows.find_all(table.get(1).unwrap_or(""))
                .iter()
                .map(|row| {
                    cells
                        .find_all(row.get(1).unwrap_or(""))
                        .iter()
                        .map(|cell| {
                            let text = cell
                                .get(1)
                                .unwrap_or("")
                                .replace("\\n", " ")
                                .replace("<br>", " ");
                            js_trim(&text).to_owned()
                        })
                        .collect::<Vec<_>>()
                        .join(" | ")
                })
                .collect::<Vec<_>>()
                .join("\n")
        },
    )
}
/// Compact internal markdown into stable entity references and readable leaf text.
pub fn markdown_to_embedding_text(markdown: &str) -> String {
    let mut text = replace(
        &strip_agent_context(markdown),
        "<m-snapshot>(.*?)</m-snapshot>",
        "s",
        |m| {
            snapshot(m.get(1).unwrap_or(""))
                .map(|data| document_ref(&data))
                .unwrap_or_default()
        },
    );
    text = flatten_tables(&text);
    text = replace(
        &text,
        "<m-email-thread-embed>(.*?)</m-email-thread-embed>",
        "s",
        |m| {
            replace(m.get(1).unwrap_or(""), r"^\{.*?\}", "", |_| String::new()).replace("\\n", "\n")
        },
    );
    text = tag(&text, "m-agent-session-mention", true, |v| {
        if let Some(id) = field(v, "id") {
            let name = field(v, "label")
                .map(js_string)
                .unwrap_or_else(|| "Agent session".into());
            format!("[{name}](agent_session:{})", js_string(id))
        } else {
            label(v, &["label"])
        }
    });
    text = tag(&text, "m-document-mention", true, document_ref);
    text = tag(&text, "m-document-card", true, document_ref);
    text = tag(&text, "m-pr-mention", true, |v| {
        if let Some(id) = field(v, "id") {
            let name = field(v, "label")
                .map(js_string)
                .unwrap_or_else(|| "Pull request".into());
            format!("[{name}](pr:{})", js_string(id))
        } else if let Some(url) = field(v, "url") {
            let name = field(v, "label")
                .map(js_string)
                .or_else(|| url.as_str().and_then(github_ref))
                .unwrap_or_else(|| "Pull request".into());
            format!("[{name}]({})", js_string(url))
        } else {
            label(v, &["label"])
        }
    });
    text = tag(&text, "m-link", true, |v| {
        if let Some(url) = field(v, "url") {
            format!("[{}]({})", label(v, &["text", "url"]), js_string(url))
        } else {
            label(v, &["text"])
        }
    });
    text = tag(&text, "m-image", true, |v| {
        let target = if v.get("srcType").and_then(Value::as_str) == Some("dss") {
            field(v, "id")
                .map(|id| format!("dss:{}", js_string(id)))
                .or_else(|| field(v, "url").map(js_string))
        } else {
            field(v, "url").map(js_string)
        };
        if let Some(target) = target {
            let alt = field(v, "alt")
                .map(js_string)
                .unwrap_or_else(|| "image".into());
            format!("[{alt}]({target})")
        } else {
            label(v, &["alt"])
        }
    });
    text = tag(&text, "m-video", true, |v| {
        field(v, "url")
            .map(|url| format!("[video]({})", js_string(url)))
            .unwrap_or_default()
    });
    text = tag(&text, "m-katex-equation", true, |v| label(v, &["equation"]));
    text = tag(&text, "m-user-mention", true, user_display);
    text = tag(&text, "m-contact-mention", true, |v| {
        label(v, &["name", "emailOrDomain"])
    });
    text = tag(&text, "m-date-mention", true, |v| {
        label(v, &["displayFormat"])
    });
    text = tag(&text, "m-group-mention", true, |v| {
        format!("@{}", label(v, &["groupAlias"]))
    });
    text = tag(&text, "m-tag", true, |v| {
        field(v, "name")
            .map(|name| format!("#{}", js_string(name)))
            .unwrap_or_default()
    });
    text = tag(&text, "m-theme-mention", true, |v| label(v, &["name"]));
    text = tag(&text, "m-connect-app", true, |v| {
        field(v, "name")
            .map(|name| format!("Connect {}", js_string(name)))
            .unwrap_or_default()
    });
    text = tag(&text, "m-account-manager-request", true, |_| {
        "Account manager request".into()
    });
    text = tag(&text, "m-db-query", true, |v| {
        let value = label(v, &["title", "prompt"]);
        if value.is_empty() {
            "Live database answer".into()
        } else {
            value
        }
    });
    text = tag(&text, "m-await", true, |v| label(v, &["text"]));
    text = tag(&text, "m-reply-target", true, |v| {
        label(v, &["displayText"])
    });
    text = tag(&text, "m-watermark", true, |_| String::new());
    replace(&text, r"<(m-[a-zA-Z0-9_-]+)>(.*?)</\1>", "s", |m| {
        if m.get(1) == Some("m-agent-context") {
            m.full().into()
        } else {
            String::new()
        }
    })
}
