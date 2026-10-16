//! Small provider representations for the existing plain-text native renderer.

use serde_json::Value;

const MAX_LABEL_CHARS: usize = 500;

pub(super) fn label(value: &Value, key: &str) -> Option<String> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.chars()
                .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
                .take(MAX_LABEL_CHARS)
                .collect::<String>()
        })
        .filter(|s| !s.trim().is_empty())
}

pub(super) fn whatsapp_location(location: &Value) -> String {
    let mut parts = vec!["Shared location".to_owned()];
    for field in ["name", "address"] {
        if let Some(value) = label(location, field) {
            parts.push(value);
        }
    }
    let coordinate = |key: &str, bound: f64| {
        location[key]
            .as_f64()
            .or_else(|| location[key].as_str()?.parse::<f64>().ok())
            .filter(|n| n.is_finite() && n.abs() <= bound)
    };
    if let (Some(latitude), Some(longitude)) =
        (coordinate("latitude", 90.0), coordinate("longitude", 180.0))
    {
        parts.push(format!("{latitude}, {longitude}"));
    }
    parts.join("\n")
}

pub(super) fn whatsapp_contacts(value: &Value) -> String {
    let Some(contacts) = value.as_array() else {
        return "Shared contact · Details unavailable".into();
    };
    let mut cards = Vec::new();
    for contact in contacts.iter().take(10) {
        let mut lines = vec![
            label(&contact["name"], "formatted_name").unwrap_or_else(|| "Shared contact".into()),
        ];
        for (collection, field) in [("phones", "phone"), ("emails", "email")] {
            for item in super::optional_array(contact, collection).iter().take(5) {
                if let Some(value) = label(item, field) {
                    lines.push(value);
                }
            }
        }
        if let Some(company) = label(&contact["org"], "company") {
            lines.push(company);
        }
        cards.push(lines.join("\n"));
    }
    if cards.is_empty() {
        "Shared contact · Details unavailable".into()
    } else {
        format!("Shared contact\n{}", cards.join("\n\n"))
    }
}

pub(super) fn whatsapp_selection(value: &Value) -> String {
    let selection = match value["type"].as_str() {
        Some("button_reply") => &value["button_reply"],
        Some("list_reply") => &value["list_reply"],
        _ => return "Content unavailable".into(),
    };
    let Some(title) = label(selection, "title") else {
        return "Selected an option".into();
    };
    match label(selection, "description") {
        Some(description) => format!("{title}\n{description}"),
        None => title,
    }
}
