use models_email::service;
use models_email::service::message::Message;

pub fn clean_threads_subject_snippet(threads: &mut Vec<service::thread::Thread>) {
    for thread in threads {
        for message in thread.messages.iter_mut() {
            clean_message_subject_snippet(message);
        }
    }
}

// decode any html and remove trailing spaces from subject and snippet
pub fn clean_message_subject_snippet(message: &mut Message) {
    if let Some(snippet) = &message.snippet {
        let snippet_str = snippet.clone();
        let escaped_snippet = html_escape::decode_html_entities(&snippet_str);
        message.snippet = Some(remove_trailing_special_chars(&escaped_snippet));
    }

    if let Some(subject) = &message.subject {
        let subject_str = subject.clone();
        let escaped_subject = html_escape::decode_html_entities(&subject_str);
        message.subject = Some(remove_trailing_special_chars(&escaped_subject));
    }
}

/// remove trailing whitespace and invisible characters
pub fn remove_trailing_special_chars(text: &str) -> String {
    // First trim any standard whitespace
    let trimmed = text.trim_end();

    // Then handle special invisible characters by finding the last visible character
    let last_visible_index = trimmed
        .char_indices()
        .filter(|(_, c)| {
            // Keep characters that are NOT in our list of invisible characters
            !is_invisible_char(*c)
        })
        .map(|(i, _)| i)
        .next_back();

    match last_visible_index {
        Some(index) => {
            // Find the end of this character (since it might be multiple bytes)
            let next_char_start = trimmed[index..]
                .chars()
                .next()
                .map_or(index, |c| index + c.len_utf8());
            trimmed[..next_char_start].to_string()
        }
        None => "".to_string(), // String is all invisible characters
    }
}

/// Helper function to determine if a character is invisible
fn is_invisible_char(c: char) -> bool {
    c.is_whitespace() ||
        // Common invisible characters
        c == '\u{200B}' || // Zero Width Space
        c == '\u{200C}' || // Zero Width Non-Joiner
        c == '\u{200D}' || // Zero Width Joiner
        c == '\u{FEFF}' || // Zero Width Non-Breaking Space
        c == '\u{00A0}' || // Non-breaking space
        c == '\u{2060}' || // Word Joiner
        c == '\u{034F}' || // Combining Grapheme Joiner

        // Other combining marks and format characters
        ('\u{0300}'..='\u{036F}').contains(&c) || // Combining Diacritical Marks
        ('\u{1AB0}'..='\u{1AFF}').contains(&c) || // Combining Diacritical Marks Extended
        ('\u{1DC0}'..='\u{1DFF}').contains(&c) || // Combining Diacritical Marks Supplement
        ('\u{20D0}'..='\u{20FF}').contains(&c) || // Combining Diacritical Marks for Symbols
        ('\u{FE00}'..='\u{FE0F}').contains(&c) || // Variation Selectors

        // Additional format characters
        ('\u{2000}'..='\u{200F}').contains(&c) || // General Punctuation (includes spaces and invisible format characters)
        ('\u{2028}'..='\u{202F}').contains(&c) || // Line/Paragraph Separator and spaces
        ('\u{205F}'..='\u{206F}').contains(&c) // Invisible format characters
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_remove_trailing_special_chars() {
        // Test case 1: Regular whitespace
        assert_eq!(
            remove_trailing_special_chars("Hello World   "),
            "Hello World"
        );

        // Test case 2: Mixed whitespace types
        assert_eq!(remove_trailing_special_chars("Testing\t\n "), "Testing");

        // Test case 3: Zero Width Non-Joiner
        assert_eq!(remove_trailing_special_chars("Text\u{200C}"), "Text");

        // Test case 4: Zero Width Non-Breaking Space
        assert_eq!(remove_trailing_special_chars("Subject\u{FEFF}"), "Subject");

        // Test case 5: Zero Width Space
        assert_eq!(remove_trailing_special_chars("Email\u{200B}"), "Email");

        // Test case 6: Zero Width Joiner
        assert_eq!(remove_trailing_special_chars("Message\u{200D}"), "Message");

        // Test case 7: Non-breaking space
        assert_eq!(remove_trailing_special_chars("Content\u{00A0}"), "Content");

        // Test case 8: Word Joiner
        assert_eq!(remove_trailing_special_chars("Title\u{2060}"), "Title");

        // Test case 9: Multiple different invisible characters
        assert_eq!(
            remove_trailing_special_chars("Mixed\u{200B}\u{200C}\u{FEFF} \t"),
            "Mixed"
        );

        // Test case 10: No trailing special characters
        assert_eq!(remove_trailing_special_chars("Clean text"), "Clean text");

        // Test case 11: Only special characters
        assert_eq!(
            remove_trailing_special_chars("\u{200B}\u{200C}\u{FEFF}"),
            ""
        );

        // Test case 12: Empty string
        assert_eq!(remove_trailing_special_chars(""), "");

        // Test case 13: Special characters in the middle (should not be removed)
        assert_eq!(
            remove_trailing_special_chars("Text\u{200B}middle\u{200C} "),
            "Text\u{200B}middle"
        );

        // Test case 14: Complex real-world example
        assert_eq!(
            remove_trailing_special_chars("Meeting agenda: Q3 Planning\u{200B}\u{200C} \t\u{2060}"),
            "Meeting agenda: Q3 Planning"
        );

        // Test case 15: A ton of special chars at the end of the string
        assert_eq!(
            remove_trailing_special_chars(
                "See the latest deals ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏ ‌ ﻿ ͏"
            ),
            "See the latest deals"
        );
    }
}
