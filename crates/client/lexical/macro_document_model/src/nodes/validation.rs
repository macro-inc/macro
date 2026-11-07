//! Pure validators and text normalization shared by node constructors.
use super::*;
use std::sync::LazyLock;
/// Whether a string is an allowed account-manager grant UUID form.
pub fn is_account_manager_grant_id(value: &str) -> bool {
    let mut groups = value.split('-');
    [8, 4, 4, 4, 12].into_iter().all(|length| {
        groups
            .next()
            .is_some_and(|g| g.len() == length && g.bytes().all(|b| b.is_ascii_hexdigit()))
    }) && groups.next().is_none()
}
/// Whether a string is an allowed connection application slug.
pub fn is_connect_app_slug(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, b'_' | b'-'))
}
/// Validate a GitHub pull-request URL with ECMAScript regex semantics.
pub fn is_github_pull_request_url(value: &str) -> bool {
    static REGEX: LazyLock<regress::Regex> = LazyLock::new(|| {
        regress::Regex::new(r"^https?://(?:www\.)?github\.com/[A-Za-z0-9-]+/[A-Za-z0-9._-]+/pull/[1-9][0-9]*(?:[/?#]\S*)?$").expect("literal PR URL regex")
    });
    REGEX.find(value).is_some()
}
/// Render a contact display name with JavaScript whitespace and initial rules.
pub fn format_contact_display_name(name: &str, email_or_domain: &str, is_company: bool) -> String {
    if is_company {
        return email_or_domain.to_owned();
    }
    let mut name = js_trim(name).to_owned();
    let parts = name.split(',').map(js_trim).collect::<Vec<_>>();
    if let [last, rest] = parts.as_slice() {
        let words = rest
            .split(is_js_whitespace)
            .filter(|s| !s.is_empty())
            .collect::<Vec<_>>();
        let first = words.first().copied().unwrap_or("");
        let middle = words
            .iter()
            .skip(1)
            .filter(|word| {
                let len = word.encode_utf16().count();
                len <= 2 || (len == 3 && word.ends_with('.'))
            })
            .map(|word| word.replacen('.', "", 1))
            .collect::<Vec<_>>()
            .join(" ");
        name = if middle.is_empty() {
            format!("{first} {last}")
        } else {
            format!("{first} {middle} {last}")
        };
    }
    name.split(is_js_whitespace)
        .filter(|s| !s.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map_or_else(String::new, |ch| {
                // JS uppercases the first UTF-16 unit; astral characters' surrogate units
                // stay unchanged, so preserve the scalar before lowercasing the rest.
                let first = if ch.len_utf16() == 2 {
                    ch.to_string()
                } else {
                    ch.to_uppercase().collect()
                };
                first + &chars.as_str().to_lowercase()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}
/// Chart modes exclude scalar and table.
pub fn is_database_query_chart_mode(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("bar" | "line" | "area" | "scatter" | "pie")
    )
}
/// Known database visualization mode.
pub fn is_database_query_display_mode(value: &Value) -> bool {
    matches!(
        value.as_str(),
        Some("scalar" | "table" | "bar" | "line" | "area" | "scatter" | "pie")
    )
}
/// Validate chart fields and normalize optional nulls, empty titles and false stack.
pub fn parse_database_query_chart(value: &Value) -> Option<DatabaseQueryChart> {
    let mut normalized = value.as_object()?.clone();
    if normalized.get("stack").is_some_and(Value::is_null) {
        normalized.shift_remove("stack");
    }
    let chart: DatabaseQueryChart = serde_json::from_value(Value::Object(normalized)).ok()?;
    if js_trim(&chart.x).is_empty()
        || chart.y.is_empty()
        || chart.y.len() > 5
        || chart
            .y
            .iter()
            .any(|y| js_trim(y).is_empty() || y == &chart.x)
    {
        return None;
    }
    let distinct = chart.y.iter().collect::<std::collections::HashSet<_>>();
    if distinct.len() != chart.y.len() {
        return None;
    }
    if chart.color.as_ref().is_some_and(|color| {
        js_trim(color).is_empty()
            || color == &chart.x
            || chart.y.len() != 1
            || chart.y.contains(color)
    }) {
        return None;
    }
    Some(DatabaseQueryChart {
        title: chart.title.filter(|s| !s.is_empty()),
        ..chart
    })
}
/// Decode one layer of the eight entities supported by lexical-core.
pub fn decode_html_entities(text: &str) -> String {
    let mut output = String::new();
    let mut rest = text;
    while !rest.is_empty() {
        let entity = [
            ("&amp;", "&"),
            ("&nbsp;", "\u{a0}"),
            ("&lt;", "<"),
            ("&gt;", ">"),
            ("&quot;", "\""),
            ("&copy;", "©"),
            ("&reg;", "®"),
            ("&trade;", "™"),
        ]
        .into_iter()
        .find(|(name, _)| {
            rest.get(..name.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(name))
        });
        if let Some((name, value)) = entity {
            output.push_str(value);
            rest = rest.get(name.len()..).unwrap_or_default();
        } else if let Some(ch) = rest.chars().next() {
            output.push(ch);
            rest = rest.get(ch.len_utf8()..).unwrap_or_default();
        }
    }
    output
}
/// Validate database source fields, decode entities and normalize absent optional values.
pub fn parse_database_query_data(value: &Value) -> Option<DatabaseQueryData> {
    let object = value.as_object()?;
    for name in ["databaseId", "tableId"] {
        if object.get(name).is_some_and(|v| !v.is_string()) {
            return None;
        }
    }
    let mut normalized = object.clone();
    if let Some(chart) = object.get("chart").filter(|v| !v.is_null()) {
        normalized.insert(
            "chart".into(),
            serde_json::to_value(parse_database_query_chart(chart)?).ok()?,
        );
    }
    let data: DatabaseQueryData = serde_json::from_value(Value::Object(normalized)).ok()?;
    if data.height.as_ref().is_some_and(|height| {
        height
            .as_f64()
            .is_none_or(|h| !h.is_finite() || !(96.0..=1600.0).contains(&h))
    }) {
        return None;
    }
    let chart = match object.get("chart").filter(|v| !v.is_null()) {
        Some(chart) => Some(parse_database_query_chart(chart)?),
        None => None,
    };
    Some(DatabaseQueryData {
        database_id: data.database_id.filter(|s| !s.is_empty()),
        table_id: data.table_id.filter(|s| !s.is_empty()),
        title: data
            .title
            .filter(|s| !s.is_empty())
            .map(|s| decode_html_entities(&s)),
        prompt: decode_html_entities(&data.prompt),
        chart,
        ..data
    })
}
