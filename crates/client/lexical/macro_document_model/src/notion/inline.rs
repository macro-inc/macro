//! Enhanced inline tags become ordinary registered nodes before Macro matching.
use super::*;
use chrono::{Datelike, TimeZone, Timelike, Utc};
use lexical_rich_nodes::link::{LinkAttributes, create_link_node};
#[derive(Debug)]
struct Inline {
    kind: usize,
    pattern: RegexMatcher,
    links: NotionLinks,
}
pub(super) fn transformers(links: &NotionLinks) -> Vec<Transformer> {
    [
        r"<(mention-page|page|database|mention-database|mention-data-source)\b([^>]*)>(.*?)</\1>",
        r"<(?:mention-page|page|database|mention-database|mention-data-source)\b([^>]*?)/>",
        r"<mention-user\b([^>]*?)(?:/>|>(.*?)</mention-user>)",
        r"<mention-agent\b[^>]*>(.*?)</mention-agent>",
        r"<mention-date\b([^>]*?)(?:/>|>(?:.*?)</mention-date>)",
        r"<(file|pdf|audio|video)\b([^>]*)>(.*?)</\1>",
        r"<(?:file|pdf|audio|video)\b([^>]*?)/?>",
        r"<unknown\b([^>]*?)/?>", r"<span\b([^>]*)>(.*?)</span>",
        r#"[ \t]*\{(?:(?:toggle|color)\s*=\s*"[^"]*"[ \t]*)+\}[ \t]*$"#,
        r"</?(?:mention-[\w-]+|span|page|ancestor-\d+-page|database|data-source|unknown|file|pdf|audio|video|image|empty-block|table_of_contents|custom-block|synced_block(?:_reference)?|columns?|callout|details|summary|ancestor-path|colgroup|col|tr|td|th|table)\b[^>]*>",
    ].iter().enumerate().map(|(kind, pattern)| Transformer::TextMatch(Arc::new(Inline { kind, pattern: regex(pattern), links: links.clone() }))).collect()
}
fn replace_link(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    url: &str,
    label: &str,
) -> Result<Option<NodeKey>> {
    let format = tx.view().text_data(node)?.format;
    let text = tx.create_text(label)?;
    tx.text(text)?.set_format(format)?;
    if web_url(url) {
        let link = create_link_node(tx, url, LinkAttributes::default())?;
        tx.append(link, &[text.key()])?;
        tx.replace(node, link, false)?;
    } else {
        tx.replace(node, text, false)?;
    }
    Ok(Some(text.key()))
}
fn page(
    tx: &mut Transaction<'_>,
    node: NodeKey,
    links: &NotionLinks,
    attrs: &BTreeMap<String, String>,
    label: &str,
) -> Result<Option<NodeKey>> {
    let reference = attrs.get("url").map_or("", String::as_str);
    if let Some(page) = notion_ids(reference)
        .iter()
        .find_map(|id| links.pages.get(id))
    {
        let mention = create_document_mention_node(
            tx,
            DocumentMentionNode {
                document_id: Maybe::Value(page.document_id.clone()),
                document_name: Maybe::Value(page.name.clone()),
                block_name: Maybe::Value("md".into()),
                ..Default::default()
            },
        )?;
        tx.replace(node, mention, false)?;
        return Ok(None);
    }
    let label = without_tags(label);
    let label = if !label.is_empty() {
        label.as_str()
    } else {
        attrs
            .get("title")
            .map(|title| js_trim(title))
            .filter(|title| !title.is_empty())
            .unwrap_or("Notion page")
    };
    replace_link(tx, node, reference, label)
}
fn date(
    tx: &mut Transaction<'_>,
    value: Option<&String>,
    time: Option<&String>,
    zone: Option<&String>,
) -> Result<Option<NodeKey>> {
    let Some(value) = value.filter(|value| regex(r"^\d{4}-\d{2}-\d{2}$").exec(value).is_some())
    else {
        return Ok(None);
    };
    let Ok(day) = chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d") else {
        return Ok(None);
    };
    let valid_time = time.filter(|time| regex(r"^\d{2}:\d{2}$").exec(time).is_some());
    let clock = valid_time
        .and_then(|time| chrono::NaiveTime::parse_from_str(time, "%H:%M").ok())
        .unwrap_or_else(|| chrono::NaiveTime::from_hms_opt(12, 0, 0).expect("valid noon"));
    let wall = day.and_time(clock).and_utc();
    let mut instant = wall;
    if valid_time.is_some()
        && let Some(zone) = zone.and_then(|zone| zone.parse::<chrono_tz::Tz>().ok())
    {
        let local = wall.with_timezone(&zone);
        if let Some(projected) = Utc
            .with_ymd_and_hms(
                local.year(),
                local.month(),
                local.day(),
                local.hour(),
                local.minute(),
                0,
            )
            .single()
        {
            instant = wall - (projected - wall);
        }
    }
    let label = format!(
        "{} {}, {}{}",
        day.format("%B"),
        day.day(),
        day.year(),
        time.map_or(String::new(), |time| format!(" {time}"))
    );
    Ok(Some(
        tx.create(DateMentionNode {
            date: Maybe::Value(instant.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            display_format: Maybe::Value(label),
            ..Default::default()
        })?
        .key(),
    ))
}
fn file_name(value: &str) -> Option<String> {
    if !web_url(value) {
        return None;
    }
    let url = url::Url::parse(value).ok()?;
    let name = url
        .path()
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())?;
    urlencoding::decode(name).ok().map(|name| name.into_owned())
}
impl TextMatchTransformer for Inline {
    fn dependencies(&self) -> &[&'static str] {
        &[]
    }
    fn reg_exp(&self) -> &dyn Matcher {
        &self.pattern
    }
    fn import_reg_exp(&self) -> Option<&dyn Matcher> {
        Some(&self.pattern)
    }
    fn replace(
        &self,
        tx: &mut Transaction<'_>,
        node: NodeKey,
        m: &Match,
    ) -> Result<Option<NodeKey>> {
        match self.kind {
            0 => page(
                tx,
                node,
                &self.links,
                &attrs(m.get(2).unwrap_or("")),
                m.get(3).unwrap_or(""),
            ),
            1 => page(tx, node, &self.links, &attrs(m.get(1).unwrap_or("")), ""),
            2 => {
                let name = without_tags(m.get(2).unwrap_or(""));
                let data = attrs(m.get(1).unwrap_or(""));
                if let Some(user) = notion_ids(data.get("url").map_or("", String::as_str))
                    .iter()
                    .find_map(|id| self.links.users.get(id))
                {
                    let mention = tx.create(UserMentionNode {
                        user_id: Maybe::Value(user.user_id.clone()),
                        email: Maybe::Value(user.email.clone()),
                        display_name: name,
                        ..Default::default()
                    })?;
                    tx.replace(node, mention, false)?;
                } else if name.is_empty() {
                    tx.remove(node, false)?;
                } else {
                    tx.text(node)?.set_text_content(&format!("@{name}"))?;
                }
                Ok(None)
            }
            3 => {
                let name = without_tags(m.get(1).unwrap_or(""));
                if name.is_empty() {
                    tx.remove(node, false)?;
                } else {
                    tx.text(node)?.set_text_content(&format!("@{name}"))?;
                }
                Ok(None)
            }
            4 => {
                let data = attrs(m.get(1).unwrap_or(""));
                let Some(start) = date(
                    tx,
                    data.get("start"),
                    data.get("startTime"),
                    data.get("timeZone"),
                )?
                else {
                    let text = tx.create_text(data.get("start").map_or("", String::as_str))?;
                    tx.replace(node, text, false)?;
                    return Ok(None);
                };
                tx.replace(node, start, false)?;
                if data.contains_key("end")
                    && data.get("end") != data.get("start")
                    && let Some(end) = date(
                        tx,
                        data.get("end"),
                        data.get("endTime"),
                        data.get("timeZone"),
                    )?
                {
                    tx.insert_after(start, end, true)?;
                    let dash = tx.create_text(" – ")?;
                    tx.insert_after(start, dash, true)?;
                }
                Ok(None)
            }
            5 | 6 => {
                let data = attrs(m.get(if self.kind == 5 { 2 } else { 1 }).unwrap_or(""));
                let url = data
                    .get("src")
                    .or_else(|| data.get("url"))
                    .map_or("", String::as_str);
                let caption = without_tags(if self.kind == 5 {
                    m.get(3).unwrap_or("")
                } else {
                    ""
                });
                let label = if caption.is_empty() {
                    file_name(url).unwrap_or("Notion file".into())
                } else {
                    caption
                };
                replace_link(tx, node, url, &label)
            }
            7 => {
                let data = attrs(m.get(1).unwrap_or(""));
                let url = data.get("url").map_or("", String::as_str);
                if notion_ids(url)
                    .iter()
                    .any(|id| self.links.pages.contains_key(id))
                {
                    return page(
                        tx,
                        node,
                        &self.links,
                        &data,
                        data.get("alt").map_or("", String::as_str),
                    );
                }
                if !web_url(url) {
                    tx.remove(node, false)?;
                    return Ok(None);
                }
                let label = data
                    .get("alt")
                    .map(|label| js_trim(label))
                    .filter(|label| !label.is_empty())
                    .unwrap_or("Unsupported Notion content");
                replace_link(tx, node, url, label)
            }
            8 => {
                tx.text(node)?.set_text_content(m.get(2).unwrap_or(""))?;
                if attrs(m.get(1).unwrap_or(""))
                    .get("underline")
                    .is_some_and(|value| value == "true")
                    && !tx
                        .view()
                        .text_data(node)?
                        .format
                        .contains(TextFormat::UNDERLINE)
                {
                    tx.text(node)?.toggle_format(TextFormatType::Underline)?;
                }
                Ok(Some(node))
            }
            _ => {
                tx.remove(node, false)?;
                Ok(None)
            }
        }
    }
}
