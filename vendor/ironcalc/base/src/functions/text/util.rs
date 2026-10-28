pub(crate) enum Case {
    Sensitive,
    Insensitive,
}

/// Finds the text after the occurrence instance of 'search_for' in text
pub(crate) fn text_after(
    text: &str,
    delimiter: &str,
    instance_num: i32,
    match_mode: Case,
) -> Option<String> {
    if let Some((_, right)) = match_text(text, delimiter, instance_num, match_mode) {
        return Some(text[right..].to_string());
    };
    None
}

pub(crate) fn text_before(
    text: &str,
    delimiter: &str,
    instance_num: i32,
    match_mode: Case,
) -> Option<String> {
    if let Some((left, _)) = match_text(text, delimiter, instance_num, match_mode) {
        return Some(text[..left].to_string());
    };
    None
}

pub(crate) fn substitute(text: &str, old_text: &str, new_text: &str, instance_num: i32) -> String {
    if let Some((left, right)) = match_text(text, old_text, instance_num, Case::Sensitive) {
        return format!("{}{}{}", &text[..left], new_text, &text[right..]);
    };
    text.to_string()
}

fn match_text(
    text: &str,
    delimiter: &str,
    instance_num: i32,
    match_mode: Case,
) -> Option<(usize, usize)> {
    match match_mode {
        Case::Sensitive => {
            if instance_num > 0 {
                text_sensitive(text, delimiter, instance_num)
            } else {
                text_sensitive_reverse(text, delimiter, -instance_num)
            }
        }
        Case::Insensitive => {
            if instance_num > 0 {
                text_sensitive(
                    &text.to_lowercase(),
                    &delimiter.to_lowercase(),
                    instance_num,
                )
            } else {
                text_sensitive_reverse(
                    &text.to_lowercase(),
                    &delimiter.to_lowercase(),
                    -instance_num,
                )
            }
        }
    }
}

fn text_sensitive(text: &str, delimiter: &str, instance_num: i32) -> Option<(usize, usize)> {
    let mut byte_index = 0;
    let mut local_index = 1;
    // delimiter length in bytes
    let delimiter_len = delimiter.len();
    for c in text.chars() {
        if text[byte_index..].starts_with(delimiter) {
            if local_index == instance_num {
                return Some((byte_index, byte_index + delimiter_len));
            } else {
                local_index += 1;
            }
        }
        byte_index += c.len_utf8();
    }
    None
}

fn text_sensitive_reverse(
    text: &str,
    delimiter: &str,
    instance_num: i32,
) -> Option<(usize, usize)> {
    let text_len = text.len();
    let mut byte_index = text_len;
    let mut local_index = 1;
    let delimiter_len = delimiter.len();
    for c in text.chars().rev() {
        if text[byte_index..].starts_with(delimiter) {
            if local_index == instance_num {
                return Some((byte_index, byte_index + delimiter_len));
            } else {
                local_index += 1;
            }
        }

        byte_index -= c.len_utf8();
    }
    None
}

#[cfg(test)]
mod tests {

    use super::{text_after, text_before, Case};
    #[test]
    fn test_text_after_sensitive() {
        assert_eq!(
            text_after("One element", "ele", 1, Case::Sensitive),
            Some("ment".to_string())
        );
        assert_eq!(
            text_after("One element", "e", 1, Case::Sensitive),
            Some(" element".to_string())
        );
        assert_eq!(
            text_after("One element", "e", 4, Case::Sensitive),
            Some("nt".to_string())
        );
        assert_eq!(text_after("One element", "e", 5, Case::Sensitive), None);
        assert_eq!(
            text_after("長壽相等！", "相", 1, Case::Sensitive),
            Some("等！".to_string())
        );
    }
    #[test]
    fn test_text_before_sensitive() {
        assert_eq!(
            text_before("One element", "ele", 1, Case::Sensitive),
            Some("One ".to_string())
        );
        assert_eq!(
            text_before("One element", "e", 1, Case::Sensitive),
            Some("On".to_string())
        );
        assert_eq!(
            text_before("One element", "e", 4, Case::Sensitive),
            Some("One elem".to_string())
        );
        assert_eq!(text_before("One element", "e", 5, Case::Sensitive), None);
        assert_eq!(
            text_before("長壽相等！", "相", 1, Case::Sensitive),
            Some("長壽".to_string())
        );
    }
    #[test]
    fn test_text_after_insensitive() {
        assert_eq!(
            text_after("One element", "eLe", 1, Case::Insensitive),
            Some("ment".to_string())
        );
        assert_eq!(
            text_after("One element", "E", 1, Case::Insensitive),
            Some(" element".to_string())
        );
        assert_eq!(
            text_after("One element", "E", 4, Case::Insensitive),
            Some("nt".to_string())
        );
        assert_eq!(text_after("One element", "E", 5, Case::Insensitive), None);
        assert_eq!(
            text_after("長壽相等！", "相", 1, Case::Insensitive),
            Some("等！".to_string())
        );
    }
    #[test]
    fn test_text_before_insensitive() {
        assert_eq!(
            text_before("One element", "eLe", 1, Case::Insensitive),
            Some("One ".to_string())
        );
        assert_eq!(
            text_before("One element", "E", 1, Case::Insensitive),
            Some("On".to_string())
        );
        assert_eq!(
            text_before("One element", "E", 4, Case::Insensitive),
            Some("One elem".to_string())
        );
        assert_eq!(text_before("One element", "E", 5, Case::Insensitive), None);
        assert_eq!(
            text_before("長壽相等！", "相", 1, Case::Insensitive),
            Some("長壽".to_string())
        );
    }
}
