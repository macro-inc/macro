//! Ordered CSS declaration parsing without a parse cache.
/// Ordered property/value declarations.
pub type StyleObject = indexmap::IndexMap<String, String>;
/// Trim ECMAScript WhiteSpace and LineTerminator characters, including BOM.
pub fn js_trim(value: &str) -> &str {
    value.trim_matches(crate::utils::is_js_whitespace)
}
/// Parse comments, quoted strings, escapes and parenthesized CSS values.
pub fn style_object_from_css(css: &str) -> StyleObject {
    let mut styles = StyleObject::new();
    let (mut property, mut value) = (String::new(), String::new());
    let (mut quote, mut comment, mut escaped, mut parsing_value, mut depth) =
        (None, false, false, false, 0u32);
    let mut chars = css.chars().peekable();
    while let Some(ch) = chars.next() {
        if comment {
            if ch == '*' && chars.peek() == Some(&'/') {
                chars.next();
                comment = false;
            }
            continue;
        }
        let target = if parsing_value {
            &mut value
        } else {
            &mut property
        };
        if escaped {
            target.push(ch);
            escaped = false;
            continue;
        }
        if let Some(q) = quote {
            target.push(ch);
            if ch == '\\' {
                escaped = true;
            } else if ch == q {
                quote = None;
            }
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            comment = true;
            continue;
        }
        match ch {
            '\'' | '"' => {
                quote = Some(ch);
                target.push(ch);
            }
            '(' => {
                depth += 1;
                target.push(ch);
            }
            ')' => {
                depth = depth.saturating_sub(1);
                target.push(ch);
            }
            ':' if !parsing_value && depth == 0 => parsing_value = true,
            ';' if depth == 0 => {
                commit(&mut styles, &property, &value);
                property.clear();
                value.clear();
                parsing_value = false;
            }
            _ => target.push(ch),
        }
    }
    commit(&mut styles, &property, &value);
    styles
}
fn commit(styles: &mut StyleObject, property: &str, value: &str) {
    let (property, value) = (js_trim(property), js_trim(value));
    if !property.is_empty() && !value.is_empty() {
        styles.insert(property.to_owned(), value.to_owned());
    }
}
/// Serialize nonempty keys in insertion order without separators between declarations.
pub fn css_from_style_object(styles: &StyleObject) -> String {
    let mut css = String::new();
    for (key, value) in styles {
        if !key.is_empty() {
            css.push_str(key);
            css.push_str(": ");
            css.push_str(value);
            css.push(';');
        }
    }
    css
}
#[cfg(test)]
mod test;
