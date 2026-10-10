//! Notion REST JSON → domain models. Unknown shapes degrade (an omitted
//! block, a skipped property) rather than failing a whole page.

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::domain::models::{
    NotionAnnotations, NotionBlock, NotionBlockKind, NotionBlockPage, NotionContainer, NotionFile,
    NotionId, NotionMention, NotionOwner, NotionPage, NotionParent, NotionProperty,
    NotionPropertyValue, NotionRichText, NotionRichTextKind, NotionSearchPage,
};
use crate::domain::ports::ApiSourceError;

fn str_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

fn time_at(value: &Value, pointer: &str) -> Option<DateTime<Utc>> {
    str_at(value, pointer)
        .and_then(|time| DateTime::parse_from_rfc3339(time).ok())
        .map(|time| time.to_utc())
}

fn id_at(value: &Value, pointer: &str) -> Option<NotionId> {
    str_at(value, pointer).and_then(NotionId::parse)
}

/// `GET /v1/users/me`: the bot's owner.
pub(super) fn owner(body: &Value) -> NotionOwner {
    match (
        str_at(body, "/bot/owner/type"),
        str_at(body, "/bot/owner/user/id"),
    ) {
        (Some("user"), Some(id)) => NotionOwner::User(id.to_string()),
        _ => NotionOwner::NotAUser,
    }
}

/// A `parent` object.
pub(super) fn parent(value: Option<&Value>) -> NotionParent {
    let Some(value) = value else {
        return NotionParent::Unknown;
    };
    let id = |key: &str| id_at(value, &format!("/{key}")).map(|id| id.as_str().to_string());
    match str_at(value, "/type") {
        Some("workspace") => NotionParent::Workspace,
        Some("page_id") => id("page_id").map_or(NotionParent::Unknown, NotionParent::Page),
        Some("database_id") => {
            id("database_id").map_or(NotionParent::Unknown, NotionParent::Database)
        }
        Some("data_source_id") => match (id("database_id"), id("data_source_id")) {
            (Some(database), _) => NotionParent::Database(database),
            (None, Some(source)) => NotionParent::DataSource(source),
            (None, None) => NotionParent::Unknown,
        },
        Some("block_id") => id("block_id").map_or(NotionParent::Unknown, NotionParent::Block),
        _ => NotionParent::Unknown,
    }
}

fn icon_emoji(value: &Value) -> Option<String> {
    (str_at(value, "/icon/type") == Some("emoji"))
        .then(|| str_at(value, "/icon/emoji").map(str::to_string))
        .flatten()
}

fn plain_text(runs: Option<&Value>) -> String {
    runs.and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .filter_map(|run| run.get("plain_text").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default()
}

/// A page object. `None` when it is not one.
pub(super) fn page(value: &Value) -> Option<NotionPage> {
    if str_at(value, "/object") != Some("page") {
        return None;
    }
    let mut title = String::new();
    let mut properties = Vec::new();
    if let Some(map) = value.get("properties").and_then(Value::as_object) {
        for (name, property) in map {
            let value = property_value(property);
            if value == NotionPropertyValue::Title {
                title = plain_text(property.get("title"));
            }
            properties.push(NotionProperty {
                name: name.clone(),
                value,
            });
        }
    }
    // Map order depends on serde_json features; keep it deterministic.
    properties.sort_by(|a, b| a.name.cmp(&b.name));
    Some(NotionPage {
        id: id_at(value, "/id")?,
        url: str_at(value, "/url")?.to_string(),
        title: title.trim().to_string(),
        icon_emoji: icon_emoji(value),
        last_edited_time: time_at(value, "/last_edited_time")?,
        last_edited_by: str_at(value, "/last_edited_by/id").map(str::to_string),
        archived: value.get("archived").and_then(Value::as_bool) == Some(true)
            || value.get("in_trash").and_then(Value::as_bool) == Some(true),
        parent: parent(value.get("parent")),
        properties,
    })
}

fn property_value(property: &Value) -> NotionPropertyValue {
    let option_name = |key: &str| str_at(property, &format!("/{key}/name")).map(str::to_string);
    match str_at(property, "/type") {
        Some("title") => NotionPropertyValue::Title,
        Some("rich_text") => NotionPropertyValue::RichText(plain_text(property.get("rich_text"))),
        Some("select") => NotionPropertyValue::Select(option_name("select")),
        Some("status") => NotionPropertyValue::Status(option_name("status")),
        Some("multi_select") => NotionPropertyValue::MultiSelect(
            property
                .get("multi_select")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|option| option.get("name").and_then(Value::as_str))
                .map(str::to_string)
                .collect(),
        ),
        Some("date") => match str_at(property, "/date/start") {
            Some(start) => NotionPropertyValue::Date {
                start: start.to_string(),
                end: str_at(property, "/date/end").map(str::to_string),
            },
            None => NotionPropertyValue::Skipped,
        },
        Some("checkbox") => NotionPropertyValue::Checkbox(
            property.get("checkbox").and_then(Value::as_bool) == Some(true),
        ),
        Some("number") => {
            NotionPropertyValue::Number(property.get("number").and_then(Value::as_f64))
        }
        Some("url") => NotionPropertyValue::Url(str_at(property, "/url").map(str::to_string)),
        _ => NotionPropertyValue::Skipped,
    }
}

/// `POST /v1/search` results. Unreadable results are skipped.
pub(super) fn search_page(body: &Value) -> Result<NotionSearchPage, ApiSourceError> {
    let results = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("unexpected Notion search response shape"))?;
    let pages = results
        .iter()
        .filter_map(|result| {
            let parsed = page(result);
            if parsed.is_none() && str_at(result, "/object") == Some("page") {
                tracing::warn!("skipping unreadable Notion search result");
            }
            parsed
        })
        .collect();
    Ok(NotionSearchPage {
        pages,
        next_cursor: next_cursor(body),
    })
}

fn next_cursor(body: &Value) -> Option<String> {
    (body.get("has_more").and_then(Value::as_bool) == Some(true))
        .then(|| str_at(body, "/next_cursor").map(str::to_string))
        .flatten()
}

/// A database object.
pub(super) fn database(value: &Value) -> Option<NotionContainer> {
    Some(NotionContainer {
        id: id_at(value, "/id")?,
        title: plain_text(value.get("title")).trim().to_string(),
        icon_emoji: icon_emoji(value),
        parent: parent(value.get("parent")),
    })
}

/// A data source's database.
pub(super) fn data_source_database(value: &Value) -> Option<NotionId> {
    id_at(value, "/parent/database_id").or_else(|| id_at(value, "/database_parent/database_id"))
}

/// `GET /v1/blocks/{id}/children`.
pub(super) fn children(body: &Value) -> Result<NotionBlockPage, ApiSourceError> {
    let results = body
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("unexpected Notion block children shape"))?;
    Ok(NotionBlockPage {
        blocks: results.iter().filter_map(block).collect(),
        next_cursor: next_cursor(body),
    })
}

/// One block (without children).
pub(super) fn block(value: &Value) -> Option<NotionBlock> {
    let id = id_at(value, "/id")?;
    let kind_name = str_at(value, "/type").unwrap_or("unsupported");
    let body = value.get(kind_name).unwrap_or(&Value::Null);
    let text = || rich_text(body.get("rich_text"));
    let caption = || rich_text(body.get("caption"));
    let kind = match kind_name {
        "paragraph" => NotionBlockKind::Paragraph(text()),
        "heading_1" | "heading_2" | "heading_3" => NotionBlockKind::Heading {
            level: kind_name.as_bytes()[8] - b'0',
            text: text(),
            toggleable: body.get("is_toggleable").and_then(Value::as_bool) == Some(true),
        },
        "bulleted_list_item" => NotionBlockKind::BulletedListItem(text()),
        "numbered_list_item" => NotionBlockKind::NumberedListItem(text()),
        "to_do" => NotionBlockKind::ToDo {
            text: text(),
            checked: body.get("checked").and_then(Value::as_bool) == Some(true),
        },
        "toggle" => NotionBlockKind::Toggle(text()),
        "quote" => NotionBlockKind::Quote(text()),
        "callout" => NotionBlockKind::Callout {
            text: text(),
            icon_emoji: icon_emoji(body),
        },
        "code" => NotionBlockKind::Code {
            text: text(),
            language: str_at(body, "/language")
                .unwrap_or("plain text")
                .to_string(),
        },
        "divider" => NotionBlockKind::Divider,
        "equation" => {
            NotionBlockKind::Equation(str_at(body, "/expression").unwrap_or_default().to_string())
        }
        "table" => NotionBlockKind::Table {
            has_column_header: body.get("has_column_header").and_then(Value::as_bool) == Some(true),
            width: body.get("table_width").and_then(Value::as_u64).unwrap_or(0) as usize,
        },
        "table_row" => NotionBlockKind::TableRow(
            body.get("cells")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .map(|cell| rich_text(Some(cell)))
                .collect(),
        ),
        "column_list" => NotionBlockKind::ColumnList,
        "column" => NotionBlockKind::Column,
        "synced_block" => NotionBlockKind::SyncedBlock {
            synced_from: id_at(body, "/synced_from/block_id"),
        },
        "image" => match file(body) {
            Some(file) => NotionBlockKind::Image {
                file,
                caption: caption(),
            },
            None => NotionBlockKind::Omitted("image".into()),
        },
        "file" | "pdf" | "video" | "audio" => match file(body) {
            Some(file) => NotionBlockKind::Attachment {
                kind: kind_name.to_string(),
                file,
                caption: caption(),
            },
            None => NotionBlockKind::Omitted(kind_name.to_string()),
        },
        "bookmark" | "embed" | "link_preview" => match str_at(body, "/url") {
            Some(url) => NotionBlockKind::Link {
                url: url.to_string(),
                caption: caption(),
            },
            None => NotionBlockKind::Omitted(kind_name.to_string()),
        },
        "child_page" => NotionBlockKind::ChildPage {
            title: str_at(body, "/title").unwrap_or_default().to_string(),
        },
        "child_database" => NotionBlockKind::ChildDatabase {
            title: str_at(body, "/title").unwrap_or_default().to_string(),
        },
        "link_to_page" => match str_at(body, "/type") {
            Some("page_id") => id_at(body, "/page_id").map_or(
                NotionBlockKind::Omitted("link_to_page".into()),
                NotionBlockKind::LinkToPage,
            ),
            Some("database_id") => id_at(body, "/database_id").map_or(
                NotionBlockKind::Omitted("link_to_page".into()),
                NotionBlockKind::LinkToDatabase,
            ),
            _ => NotionBlockKind::Omitted("link_to_page".into()),
        },
        other => NotionBlockKind::Omitted(other.to_string()),
    };
    Some(NotionBlock {
        id,
        kind,
        has_children: value.get("has_children").and_then(Value::as_bool) == Some(true),
        children: Vec::new(),
    })
}

fn file(body: &Value) -> Option<NotionFile> {
    let (url, hosted) = match str_at(body, "/type")? {
        "file" => (str_at(body, "/file/url")?, true),
        "external" => (str_at(body, "/external/url")?, false),
        _ => return None,
    };
    Some(NotionFile {
        url: url.to_string(),
        hosted,
        name: str_at(body, "/name")
            .filter(|name| !name.trim().is_empty())
            .map(str::to_string),
    })
}

/// A rich-text array.
fn rich_text(value: Option<&Value>) -> Vec<NotionRichText> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(rich_text_run)
        .collect()
}

fn rich_text_run(run: &Value) -> Option<NotionRichText> {
    let plain_text = run.get("plain_text").and_then(Value::as_str)?.to_string();
    let flag = |name: &str| {
        run.pointer(&format!("/annotations/{name}"))
            .and_then(Value::as_bool)
            == Some(true)
    };
    let annotations = NotionAnnotations {
        bold: flag("bold"),
        italic: flag("italic"),
        strikethrough: flag("strikethrough"),
        underline: flag("underline"),
        code: flag("code"),
    };
    let kind = match str_at(run, "/type") {
        Some("equation") => NotionRichTextKind::Equation(
            str_at(run, "/equation/expression")
                .unwrap_or(&plain_text)
                .to_string(),
        ),
        Some("mention") => NotionRichTextKind::Mention(mention(run.get("mention")?)),
        _ => NotionRichTextKind::Text {
            link: str_at(run, "/text/link/url")
                .or_else(|| str_at(run, "/href"))
                .map(str::to_string),
        },
    };
    Some(NotionRichText {
        kind,
        plain_text,
        annotations,
    })
}

fn mention(value: &Value) -> NotionMention {
    match str_at(value, "/type") {
        Some("user") => NotionMention::User {
            name: str_at(value, "/user/name").map(str::to_string),
        },
        Some("page") => id_at(value, "/page/id").map_or(NotionMention::Other, NotionMention::Page),
        Some("database") => {
            id_at(value, "/database/id").map_or(NotionMention::Other, NotionMention::Database)
        }
        Some("date") => match str_at(value, "/date/start") {
            Some(start) => NotionMention::Date {
                start: start.to_string(),
                end: str_at(value, "/date/end").map(str::to_string),
            },
            None => NotionMention::Other,
        },
        Some("link_preview") => str_at(value, "/link_preview/url")
            .map_or(NotionMention::Other, |url| {
                NotionMention::LinkPreview(url.to_string())
            }),
        _ => NotionMention::Other,
    }
}
