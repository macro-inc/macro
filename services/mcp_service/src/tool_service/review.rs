//! Standard MCP forms for reviewing Macro product tool arguments.
use rmcp::model::ElicitationSchema;
use serde_json::{Map, Value, json};

pub(super) const DRAFT_FIELD: &str = "draft";

/// Project primitive arguments; the complete draft remains editable as JSON.
pub(super) fn project_form(
    schema: &Map<String, Value>,
    draft: &Value,
) -> Result<ElicitationSchema, String> {
    let mut properties = Map::new();
    if let Some(fields) = schema.get("properties").and_then(Value::as_object) {
        for (name, field) in fields {
            let field = non_null(field);
            let mut projected = if let Some(options) = choice_options(field) {
                json!({"type": "string", "enum": options})
            } else {
                let Some(kind @ ("string" | "number" | "integer" | "boolean")) = json_type(field)
                else {
                    continue;
                };
                json!({"type": kind})
            };
            for key in [
                "title",
                "description",
                "minimum",
                "maximum",
                "minLength",
                "maxLength",
            ] {
                if let Some(value) = field.get(key) {
                    projected[key] = value.clone();
                }
            }
            if let Some(value) = draft.get(name).filter(|value| !value.is_null()) {
                projected["default"] = value.clone();
            }
            properties.insert(name.clone(), projected);
        }
    }
    properties.insert(DRAFT_FIELD.to_owned(), json!({
        "type": "string", "title": "Complete draft (JSON)",
        "description": format!("Optional replacement for the entire draft. Otherwise edit the fields above. Current draft: {}", draft)
    }));
    // Defaults are applied to the original draft. Requiring projected fields would
    // prevent a composer from submitting just the complete edited JSON draft.
    serde_json::from_value(json!({"type":"object", "properties": properties}))
        .map_err(|error| error.to_string())
}

/// External email clients get editable address lists and the message, without
/// the private composer's transport fields. Explicit reply/signature choices
/// remain visible so the user can review them.
pub(super) fn email_form(draft: &Value) -> Result<ElicitationSchema, String> {
    let mut properties = Map::new();
    for (name, title, description) in [
        ("to", "To", "Email addresses, separated by commas."),
        ("cc", "Cc", "Email addresses, separated by commas."),
        ("bcc", "Bcc", "Email addresses, separated by commas."),
    ] {
        let recipients = draft.get(name).and_then(Value::as_array);
        if name != "to" && recipients.is_none_or(Vec::is_empty) {
            continue;
        }
        let addresses = recipients
            .into_iter()
            .flatten()
            .filter_map(|recipient| recipient.get("email").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(", ");
        properties.insert(
            name.into(),
            json!({"type":"string", "title":title,
            "description":description, "default":addresses}),
        );
    }
    for (name, title, description, kind) in [
        ("subject", "Subject", "Email subject.", "string"),
        (
            "body",
            "Body",
            "Email message (Markdown supported).",
            "string",
        ),
        (
            "replyingToId",
            "Reply to message",
            "Message ID this email replies to.",
            "string",
        ),
        (
            "includeSignature",
            "Include signature",
            "Include your email signature.",
            "boolean",
        ),
    ] {
        let value = draft.get(name).filter(|value| !value.is_null());
        if value.is_none() && !["subject", "body"].contains(&name) {
            continue;
        }
        let mut field = json!({"type":kind,"title":title,"description":description});
        if let Some(value) = value {
            field["default"] = value.clone();
        }
        properties.insert(name.into(), field);
    }
    serde_json::from_value(json!({"type":"object","properties":properties}))
        .map_err(|error| error.to_string())
}

/// Turn plain address edits back into tool recipients. Keep display names for
/// unchanged addresses; never interpret a malformed address as the old value.
fn email_recipient_edits(draft: &Value, content: &mut Map<String, Value>) -> Result<(), String> {
    for name in ["to", "cc", "bcc"] {
        let Some(value) = content.get(name) else {
            continue;
        };
        let text = value
            .as_str()
            .ok_or("recipient fields must be comma-separated email addresses")?;
        let mut recipients = Vec::new();
        for address in text
            .split(',')
            .map(str::trim)
            .filter(|address| !address.is_empty())
        {
            let valid = address.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty() && !domain.is_empty() && !domain.contains('@')
            }) && !address
                .chars()
                .any(|c| c.is_whitespace() || matches!(c, '<' | '>' | ';'));
            if !valid {
                return Err(
                    "Enter email addresses separated by commas (without display names).".into(),
                );
            }
            let original = draft
                .get(name)
                .and_then(Value::as_array)
                .and_then(|values| {
                    values
                        .iter()
                        .find(|value| value["email"].as_str() == Some(address))
                });
            recipients.push(
                original
                    .cloned()
                    .unwrap_or_else(|| json!({"email":address})),
            );
        }
        if name == "to" && recipients.is_empty() {
            return Err("At least one To recipient is required.".into());
        }
        content.insert(name.into(), Value::Array(recipients));
    }
    Ok(())
}

/// Merge edited fields, rejecting a malformed replacement instead of executing the old draft.
pub(super) fn apply_review(draft: &Value, content: &Value) -> Result<Value, String> {
    let content = content
        .as_object()
        .ok_or("the accepted form must contain an object")?;
    if let Some(whole) = content.get(DRAFT_FIELD) {
        let text = whole
            .as_str()
            .ok_or("the complete draft must be a JSON string")?;
        if !text.trim().is_empty() {
            let parsed: Value =
                serde_json::from_str(text).map_err(|_| "the complete draft is not valid JSON")?;
            if !parsed.is_object() {
                return Err("the complete draft must be an object".to_owned());
            }
            return Ok(parsed);
        }
    }
    let mut args = draft
        .as_object()
        .cloned()
        .ok_or("the tool draft must be an object")?;
    for (name, value) in content {
        if name != DRAFT_FIELD {
            args.insert(name.clone(), value.clone());
        }
    }
    Ok(Value::Object(args))
}

#[cfg(test)]
mod test;

/// The string values a property allows, when it is a choice among fixed
/// strings: a plain `enum`, or - how a documented Rust enum comes out - an
/// `anyOf`/`oneOf` whose every real variant is one `const` string (or a
/// one-value `enum`).
fn choice_options(property: &Value) -> Option<Vec<String>> {
    if let Some(options) = property.get("enum").and_then(Value::as_array) {
        let options: Vec<String> = options
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        return (!options.is_empty()).then_some(options);
    }
    let variants = ["anyOf", "oneOf"]
        .into_iter()
        .find_map(|key| property.get(key).and_then(Value::as_array))?;
    let mut options = Vec::new();
    for variant in variants {
        if json_type(variant) == Some("null") {
            continue;
        }
        let value = variant.get("const").and_then(Value::as_str).or_else(|| {
            match variant.get("enum").and_then(Value::as_array)?.as_slice() {
                [only] => only.as_str(),
                _ => None,
            }
        })?;
        options.push(value.to_owned());
    }
    (!options.is_empty()).then_some(options)
}

/// The property with a nullable wrapper removed: `anyOf`/`oneOf` of one real
/// schema and `null` reads as that schema.
fn non_null(property: &Value) -> &Value {
    for key in ["anyOf", "oneOf"] {
        if let Some(variants) = property.get(key).and_then(Value::as_array) {
            let real: Vec<&Value> = variants
                .iter()
                .filter(|variant| json_type(variant) != Some("null"))
                .collect();
            if let [only] = real[..] {
                return only;
            }
        }
    }
    property
}

/// The one JSON type a property declares, reading `["string", "null"]` as
/// `string`. `None` for a property with several real types or none.
fn json_type(property: &Value) -> Option<&str> {
    match property.get("type")? {
        Value::String(name) => Some(name.as_str()),
        Value::Array(names) => {
            let real: Vec<&str> = names
                .iter()
                .filter_map(Value::as_str)
                .filter(|name| *name != "null")
                .collect();
            match real[..] {
                [only] => Some(only),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Email composers return encoded HTML; standard forms edit Markdown. Keep that
/// distinction explicit rather than guessing an encoding from the user's text.
pub(super) fn tool_schema(name: &str, schema: &Map<String, Value>) -> Map<String, Value> {
    let mut schema = schema.clone();
    if name == "SendEmail"
        && let Some(properties) = schema.get_mut("properties").and_then(Value::as_object_mut)
    {
        properties.insert("bodyFormat".into(), json!({
                "type":"string", "title":"Body format",
                "enum":["markdown", "base64url_html"],
                "description":"Use markdown for text edits. Macro's email composer submits base64url_html."
            }));
    }
    schema
}

pub(super) fn reviewed_arguments(
    name: &str,
    draft: &Value,
    content: &Value,
) -> Result<Value, String> {
    if name != "SendEmail" {
        return apply_review(draft, content);
    }
    use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
    let mut content = content
        .as_object()
        .cloned()
        .ok_or("the accepted form must contain an object")?;
    let format = content.remove("bodyFormat").unwrap_or(json!("markdown"));
    // A complete composer draft takes precedence over any prepopulated fields.
    if content
        .get(DRAFT_FIELD)
        .and_then(Value::as_str)
        .is_none_or(|text| text.trim().is_empty())
    {
        email_recipient_edits(draft, &mut content)?;
    }
    let mut reviewed = apply_review(draft, &Value::Object(content))?;
    let body = reviewed
        .get("body")
        .and_then(Value::as_str)
        .ok_or("the email body must be text")?;
    match format.as_str() {
        Some("markdown") => {
            let mut html = String::new();
            pulldown_cmark::html::push_html(&mut html, pulldown_cmark::Parser::new(body));
            reviewed["body"] = Value::String(URL_SAFE_NO_PAD.encode(html));
        }
        Some("base64url_html") => {
            let bytes = URL_SAFE_NO_PAD
                .decode(body)
                .map_err(|_| "the composer body is not base64url HTML")?;
            std::str::from_utf8(&bytes).map_err(|_| "the composer body is not UTF-8")?;
        }
        _ => return Err("unsupported email body format".into()),
    }
    Ok(reviewed)
}
