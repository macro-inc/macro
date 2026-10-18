//! Supported approved text-template shapes and their ordered inputs.

use super::models::MessagingError;
use serde_json::Value;

/// One text value supplied to an approved header or body.
#[derive(Debug, PartialEq, Eq)]
pub struct TextParameter {
    /// Provider component name, either `header` or `body`.
    pub component: &'static str,
    /// Named variable; absent for positional templates.
    pub name: Option<String>,
    /// One-based position within its component.
    pub position: u8,
}

impl TextParameter {
    /// Human-readable input label shared by the composer and provider serializer.
    pub fn label(&self) -> String {
        format!(
            "{} · {}",
            self.component,
            self.name
                .as_deref()
                .map(str::to_owned)
                .unwrap_or_else(|| format!("parameter {}", self.position))
        )
    }
}

/// Validate the supported template subset before offering it as a send action.
/// Media headers, flows and dynamic buttons require different inputs and are
/// displayed as unavailable instead of failing after a human submits a reply.
pub fn text_parameters(components: &Value) -> Result<Vec<TextParameter>, MessagingError> {
    let mut result = Vec::new();
    for component in components
        .as_array()
        .ok_or(MessagingError::ProviderRejected)?
    {
        let kind = component["type"]
            .as_str()
            .ok_or(MessagingError::ProviderRejected)?;
        let target = match kind {
            "HEADER" if component["format"] == "TEXT" => "header",
            "BODY" => "body",
            "FOOTER" if !component.to_string().contains("{{") => continue,
            "BUTTONS"
                if component["buttons"].as_array().is_some_and(|buttons| {
                    buttons.iter().all(|b| {
                        matches!(
                            b["type"].as_str(),
                            Some("URL" | "PHONE_NUMBER" | "QUICK_REPLY")
                        ) && !b.to_string().contains("{{")
                    })
                }) =>
            {
                continue;
            }
            _ => {
                return Err(MessagingError::Invalid(
                    "This template needs a media header or interactive inputs. Choose a text template.",
                ));
            }
        };
        let text = component["text"]
            .as_str()
            .ok_or(MessagingError::ProviderRejected)?;
        let mut names = Vec::<String>::new();
        for part in text.split("{{").skip(1) {
            let name = part
                .split_once("}}")
                .map(|(name, _)| name)
                .ok_or(MessagingError::ProviderRejected)?;
            if name.is_empty() || name.len() > 64 || names.len() >= 50 {
                return Err(MessagingError::ProviderRejected);
            }
            if !names.iter().any(|old| old == name) {
                names.push(name.into());
            }
        }
        let positional = names
            .iter()
            .all(|name| name.bytes().all(|c| c.is_ascii_digit()));
        if positional {
            names.sort_by_key(|name| name.parse::<u8>().unwrap_or(0));
            for (index, name) in names.iter().enumerate() {
                if name.parse::<usize>().ok() != Some(index + 1) {
                    return Err(MessagingError::ProviderRejected);
                }
            }
        } else if names
            .iter()
            .any(|name| !name.bytes().all(|c| c.is_ascii_lowercase() || c == b'_'))
        {
            return Err(MessagingError::ProviderRejected);
        }
        for (index, name) in names.into_iter().enumerate() {
            result.push(TextParameter {
                component: target,
                name: (!positional).then_some(name),
                position: (index + 1) as u8,
            });
        }
    }
    if result.len() > 50 {
        return Err(MessagingError::ProviderRejected);
    }
    Ok(result)
}

#[cfg(test)]
mod test;

/// Render the approved text with the same component inputs used for dispatch.
pub fn render_text(components: &Value, values: &[String]) -> Result<String, MessagingError> {
    let layout = text_parameters(components)?;
    if layout.len() != values.len() {
        return Err(MessagingError::Invalid(
            "template parameter count does not match the approved text",
        ));
    }
    let mut rendered = Vec::new();
    for part in components
        .as_array()
        .ok_or(MessagingError::ProviderRejected)?
    {
        let kind = part["type"]
            .as_str()
            .unwrap_or_default()
            .to_ascii_lowercase();
        let Some(text) = part["text"].as_str() else {
            continue;
        };
        let mut parts = text.split("{{");
        let mut output = parts.next().unwrap_or_default().to_owned();
        for part in parts {
            let (name, rest) = part
                .split_once("}}")
                .ok_or(MessagingError::ProviderRejected)?;
            let (_, value) = layout
                .iter()
                .zip(values)
                .find(|(p, _)| {
                    p.component == kind
                        && p.name
                            .as_deref()
                            .map_or_else(|| p.position.to_string() == name, |n| n == name)
                })
                .ok_or(MessagingError::ProviderRejected)?;
            output.push_str(value);
            output.push_str(rest);
        }
        rendered.push(output);
    }
    Ok(rendered.join("\n"))
}
