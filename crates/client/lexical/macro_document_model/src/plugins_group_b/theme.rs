//! Source theme JSON validation and legacy token migration for structured paste.
use super::*;
use serde_json::{Map, Value, json};
use std::sync::LazyLock;

static CONSTANTS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(include_str!("theme-paste-constants.json"))
        .expect("generated theme paste constants")
});
#[derive(Clone, Copy)]
struct Color {
    l: f64,
    c: f64,
    h: f64,
}
fn color(value: &Value) -> Option<Color> {
    Some(Color {
        l: value.get("l")?.as_f64()?,
        c: value.get("c")?.as_f64()?,
        h: value.get("h")?.as_f64()?,
    })
}
fn round(value: f64) -> String {
    round_added(value + f64::EPSILON)
}
fn round_added(value: f64) -> String {
    let scaled = value * 100_000_000.0;
    let floor = scaled.floor();
    let rounded = if scaled - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    };
    let rounded = rounded / 100_000_000.0;
    if rounded.is_nan() {
        return "NaN".into();
    }
    if rounded == f64::INFINITY {
        return "Infinity".into();
    }
    if rounded == f64::NEG_INFINITY {
        return "-Infinity".into();
    }
    lexical_model::to_js_json_string(&lexical_model::js_number(if rounded == 0.0 {
        0.0
    } else {
        rounded
    }))
}
fn css(color: Color) -> Value {
    Value::String(format!(
        "oklch({} {} {}deg)",
        round(color.l),
        round(color.c),
        round(color.h)
    ))
}
fn legacy_color(tokens: &Map<String, Value>, key: &str) -> Result<Color, Error> {
    tokens
        .get(key)
        .and_then(color)
        .ok_or(Error::Invariant("validated theme color"))
}
fn primitive_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(value) => value.to_string(),
        Value::Number(_) => lexical_model::to_js_json_string(value),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                if value.is_null() {
                    String::new()
                } else {
                    primitive_string(value)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}
fn override_color(value: &Value) -> Result<Value, Error> {
    if value.is_null() {
        return Err(Error::Invariant("theme override color"));
    }
    let number = |key| {
        let added = match value.get(key) {
            Some(Value::Number(value)) => value.as_f64().unwrap_or(f64::NAN) + f64::EPSILON,
            Some(Value::Bool(value)) => f64::from(u8::from(*value)) + f64::EPSILON,
            Some(Value::Null) => f64::EPSILON,
            Some(value) => {
                lexical_model::js_trim(&format!("{}2.220446049250313e-16", primitive_string(value)))
                    .parse::<f64>()
                    .unwrap_or(f64::NAN)
            }
            None => f64::NAN,
        };
        round_added(added)
    };
    Ok(Value::String(format!(
        "oklch({} {} {}deg)",
        number("l"),
        number("c"),
        number("h")
    )))
}

/// Validate pasted V3 data or migrate a source-compatible legacy V2 theme.
pub fn parse_pasted_theme(text: &str) -> Result<Option<Map<String, Value>>, Error> {
    let Ok(Value::Object(data)) = serde_json::from_str(text) else {
        return Ok(None);
    };
    if !data.get("id").is_some_and(Value::is_string)
        || !data.get("name").is_some_and(Value::is_string)
    {
        return Ok(None);
    }
    let version = data.get("version").and_then(Value::as_f64);
    if version == Some(3.0) {
        if !matches!(
            data.get("mode").and_then(Value::as_str),
            Some("light" | "dark")
        ) {
            return Ok(None);
        }
        let Some(colors) = data.get("colorTokens").and_then(Value::as_object) else {
            return Ok(None);
        };
        if colors.values().any(|value| {
            !value
                .as_str()
                .is_some_and(|value| !lexical_model::js_trim(value).is_empty())
        }) {
            return Ok(None);
        }
        let inputs = CONSTANTS
            .get("inputs")
            .and_then(Value::as_array)
            .ok_or(Error::Invariant("theme input catalog"))?;
        if !inputs.iter().all(|key| {
            key.as_str()
                .is_some_and(|key| colors.get(key).is_some_and(Value::is_string))
        }) {
            return Ok(None);
        }
        return Ok(Some(data));
    }
    if version != Some(2.0) || !data.get("depth").is_some_and(Value::is_number) {
        return Ok(None);
    }
    let Some(tokens) = data.get("tokens").and_then(Value::as_object) else {
        return Ok(None);
    };
    for prefix in ['a', 'b', 'c'] {
        for index in 0..5 {
            if !tokens
                .get(&format!("{prefix}{index}"))
                .is_some_and(|value| color(value).is_some())
            {
                return Ok(None);
            }
        }
    }
    let extra = match data.get("colorTokens") {
        None => Map::new(),
        Some(Value::Object(colors)) if colors.values().all(Value::is_string) => colors.clone(),
        Some(Value::Array(colors)) if colors.iter().all(Value::is_string) => colors
            .iter()
            .enumerate()
            .map(|(index, value)| (index.to_string(), value.clone()))
            .collect(),
        _ => return Ok(None),
    };
    let base = legacy_color(tokens, "b0")?;
    let accent = legacy_color(tokens, "a0")?;
    let dark = legacy_color(tokens, "c0")?.l > base.l;
    let mode = if dark { "dark" } else { "light" };
    let mut colors = Map::new();
    let mut previous = base.l;
    for index in 0..5 {
        let color = if dark {
            let current = legacy_color(tokens, &format!("b{index}"))?;
            previous = previous.max(current.l);
            Color {
                l: previous,
                ..current
            }
        } else {
            let progress = f64::from(index) / 4.0;
            Color {
                l: (base.l + (1.0 - base.l) * progress).clamp(0.0, 1.0),
                c: base.c * (1.0 - progress),
                h: base.h,
            }
        };
        colors.insert(format!("surface-{index}"), css(color));
    }
    for index in 0..5 {
        colors.insert(
            format!("content-{index}"),
            css(legacy_color(tokens, &format!("c{index}"))?),
        );
    }
    colors.insert("edge".into(), css(legacy_color(tokens, "b4")?));
    colors.insert("edge-muted".into(), css(legacy_color(tokens, "b3")?));
    colors.insert("accent".into(), css(accent));
    let hues = CONSTANTS
        .get("hues")
        .and_then(Value::as_object)
        .ok_or(Error::Invariant("theme hue catalog"))?;
    for (name, hue) in hues {
        colors.insert(
            name.clone(),
            css(Color {
                h: hue.as_f64().ok_or(Error::Invariant("theme hue"))?,
                ..accent
            }),
        );
    }
    let defaults = CONSTANTS
        .get("semantics")
        .and_then(|semantics| semantics.get(mode))
        .and_then(Value::as_object)
        .ok_or(Error::Invariant("theme semantic catalog"))?;
    colors.extend(defaults.clone());
    if let Some(overrides) = data.get("overrides").filter(|value| !value.is_null()) {
        let overrides = overrides
            .as_array()
            .ok_or(Error::Invariant("theme overrides array"))?;
        for entry in overrides {
            if entry.is_null() {
                return Err(Error::Invariant("theme override"));
            }
            let Some(token) = entry
                .get("token")
                .and_then(Value::as_str)
                .filter(|token| defaults.contains_key(*token))
            else {
                continue;
            };
            let value = entry
                .get("value")
                .ok_or(Error::Invariant("theme override color"))?;
            colors.insert(token.into(), override_color(value)?);
        }
    }
    colors.extend(extra);
    let mut result = Map::new();
    result.insert(
        "id".into(),
        data.get("id")
            .cloned()
            .ok_or(Error::Invariant("theme id"))?,
    );
    result.insert(
        "name".into(),
        data.get("name")
            .cloned()
            .ok_or(Error::Invariant("theme name"))?,
    );
    result.insert("version".into(), json!(3));
    result.insert("mode".into(), mode.into());
    result.insert("colorTokens".into(), Value::Object(colors));
    Ok(Some(result))
}

#[cfg(test)]
mod test {
    use super::*;
    #[test]
    fn pasted_themes_match_the_actual_source_validator_and_migration() -> Result<(), Error> {
        let cases: Value = serde_json::from_str(include_str!("theme-paste-cases.json"))?;
        for (index, case) in cases.as_array().expect("cases").iter().enumerate() {
            let actual = parse_pasted_theme(&serde_json::to_string(&case["input"])?)?
                .map(Value::Object)
                .unwrap_or(Value::Null);
            assert_eq!(actual, case["expected"], "source theme case {index}");
        }
        Ok(())
    }
}
