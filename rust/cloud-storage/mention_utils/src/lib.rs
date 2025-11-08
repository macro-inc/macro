use anyhow::Context;
use regex::Regex;
use serde::Deserialize;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum Mention {
    User(UserMention),
    Document(DocumentMention),
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserMention {
    pub user_id: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMention {
    pub document_name: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ContactMention {
    name: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct DateMention {
    display_format: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct LinkMention {
    text: String,
    url: String,
}

pub const USER_MENTION_REGEX: &str = r#"<m-user-mention>(.*?)<\/m-user-mention>"#;
pub const DOCUMENT_MENTION_REGEX: &str = r#"<m-document-mention>(.*?)<\/m-document-mention>"#;
pub const CONTACT_MENTION_REGEX: &str = r#"<m-contact-mention>(.*?)<\/m-contact-mention>"#;
pub const DATE_MENTION_REGEX: &str = r#"<m-date-mention>(.*?)<\/m-date-mention>"#;
pub const LINK_REGEX: &str = r#"<m-link>(.*?)<\/m-link>"#;

pub fn parse_document_mentions(message: &str) -> anyhow::Result<Vec<Mention>> {
    let re = regex::Regex::new(DOCUMENT_MENTION_REGEX).unwrap();
    let mut mentions = Vec::new();

    for capture in re.captures_iter(message) {
        let document_mention_match = capture
            .get(1)
            .context("no document mention match")?
            .as_str();
        let document_mention: DocumentMention = serde_json::from_str(document_mention_match)
            .context("unable to parse document mention")?;
        mentions.push(Mention::Document(document_mention));
    }

    Ok(mentions)
}

pub fn parse_user_mentions(message: &str) -> anyhow::Result<Vec<Mention>> {
    let re = regex::Regex::new(USER_MENTION_REGEX).unwrap();
    let mut mentions = Vec::new();

    for capture in re.captures_iter(message) {
        let user_mention_match = capture.get(1).context("no user mention match")?.as_str();
        let user_mention: UserMention =
            serde_json::from_str(user_mention_match).context("unable to parse user mention")?;
        mentions.push(Mention::User(user_mention));
    }

    Ok(mentions)
}

/// Takes a message and updates it to have the mentions replaced with the correct mention information
/// NOTE: we will soon use lexical package to parse this stuff for document search.
pub fn format_message_mentions(message: &str) -> String {
    // We'll use regex to replace each mention in the original order
    let mut result = message.to_string();

    // Process contact mentions
    result = process_mentions::<ContactMention, _>(&result, CONTACT_MENTION_REGEX, |contact| {
        format!("@{}", contact.name)
    });

    // Process user mentions
    result = process_mentions::<UserMention, _>(&result, USER_MENTION_REGEX, |user| {
        format!("@{}", user.email.split('@').next().unwrap_or(&user.email))
    });

    // Process document mentions
    result = process_mentions::<DocumentMention, _>(&result, DOCUMENT_MENTION_REGEX, |document| {
        format!("[{}]", document.document_name.clone())
    });

    // Process date mentions
    result = process_mentions::<DateMention, _>(&result, DATE_MENTION_REGEX, |date| {
        date.display_format.clone()
    });

    // Process link mentions
    result = process_mentions::<LinkMention, _>(&result, LINK_REGEX, |link| {
        if link.url == link.text {
            link.url.clone()
        } else {
            format!("[{}]({})", link.text, link.url)
        }
    });

    result
}

/// Process mentions of a specific type in a message
fn process_mentions<T, F>(message: &str, regex_pattern: &str, format_fn: F) -> String
where
    T: for<'de> Deserialize<'de>,
    F: Fn(&T) -> String,
{
    let re = Regex::new(regex_pattern).unwrap();
    let mut result = message.to_string();

    for cap in re.captures_iter(message) {
        let full_match = cap.get(0).unwrap().as_str();
        let json_content = cap.get(1).unwrap().as_str();

        if let Ok(mention) = serde_json::from_str::<T>(json_content) {
            let replacement = format_fn(&mention);
            result = result.replace(full_match, &replacement);
        }
    }

    result
}

pub fn remove_mentions_from_content(content: &str) -> String {
    let mut result = content.to_string();

    let document_re = regex::Regex::new(DOCUMENT_MENTION_REGEX).unwrap();
    result = document_re
        .replace_all(&result, |_caps: &regex::Captures| "".to_string())
        .to_string();

    let user_re = regex::Regex::new(USER_MENTION_REGEX).unwrap();
    result = user_re
        .replace_all(&result, |_caps: &regex::Captures| "".to_string())
        .to_string();

    let contact_re = regex::Regex::new(CONTACT_MENTION_REGEX).unwrap();
    result = contact_re
        .replace_all(&result, |_caps: &regex::Captures| "".to_string())
        .to_string();

    let date_re = regex::Regex::new(DATE_MENTION_REGEX).unwrap();
    result = date_re
        .replace_all(&result, |_caps: &regex::Captures| "".to_string())
        .to_string();

    // Replace all "   " with " "
    result = result.replace("   ", " ");

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_document_mentions() -> anyhow::Result<()> {
        let message = r#"I'm testing sending a message with a document  <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention> mention  <m-document-mention>{"documentId":"doc-2","blockName":"md","documentName":"Document 2","blockParams":{}}</m-document-mention>"#;
        let mentions = parse_document_mentions(message)?;
        assert_eq!(
            mentions,
            vec![
                Mention::Document(DocumentMention {
                    document_name: "Document 1".to_string()
                }),
                Mention::Document(DocumentMention {
                    document_name: "Document 2".to_string()
                })
            ]
        );

        let message = r#"I'm testing a regular message"#;
        let mentions = parse_document_mentions(message)?;
        assert_eq!(mentions, Vec::new());

        Ok(())
    }

    #[test]
    fn test_parse_user_mentions() -> anyhow::Result<()> {
        let message = r#"<m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention>"#;
        let mentions = parse_user_mentions(message)?;
        assert_eq!(
            mentions,
            vec![Mention::User(UserMention {
                user_id: "macro|rithy@macro.com".to_string(),
                email: "rithy@macro.com".to_string()
            }),]
        );

        let message = r#"I'm testing a regular message"#;
        let mentions = parse_user_mentions(message)?;
        assert_eq!(mentions, Vec::new());

        Ok(())
    }

    #[test]
    fn test_remove_mentions_from_content() -> anyhow::Result<()> {
        let message = r#"<m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention> I'm testing sending a message with a document  <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention> mention  <m-document-mention>{"documentId":"doc-2","blockName":"md","documentName":"Document 2","blockParams":{}}</m-document-mention>"#;
        let message = remove_mentions_from_content(message);

        assert_eq!(
            message,
            r#" I'm testing sending a message with a document mention  "#
        );

        Ok(())
    }

    #[test]
    fn test_sanitize_contact_mention() {
        let input = r#"asdf <m-contact-mention>{"contactId":"ness@macro.com","name":"Ness Chu","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> asdf"#;
        let expected = "asdf @Ness Chu asdf";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_user_mention() {
        let input = r#"asdf <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention> asdf"#;
        let expected = "asdf @chase asdf";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_document_mention() {
        let input = r#"asdf <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> asdf"#;
        let expected = "asdf [Test Doc 34] asdf";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_date_mention() {
        let input = r#"asdf <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention>"#;
        let expected = "asdf Mon, Dec 1, 2025";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_mixed_mentions() {
        let input = r#"Hi <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>, let's discuss <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> with <m-contact-mention>{"contactId":"ness@macro.com","name":"Ness Chu","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> on <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention>"#;
        let expected = "Hi @chase, let's discuss [Test Doc 34] with @Ness Chu on Mon, Dec 1, 2025";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_message_no_mentions() {
        let input = "Just a regular message with no mentions";
        let expected = "Just a regular message with no mentions";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_message_invalid_json() {
        let input =
            r#"<m-user-mention>{"userId":"macro|chase@macro.com",INVALID}</m-user-mention> asdf"#;

        // Should still return a result, but without replacing the invalid tag
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_missing_field_contact_mention() {
        // Missing "name" field which is used in the replacement
        let input = r#"<m-contact-mention>{"contactId":"ness@macro.com","emailOrDomain":"ness@macro.com","isCompany":false}</m-contact-mention> asdf"#;

        // Should keep the original text since the name field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_missing_field_user_mention() {
        // Missing "email" field which is used to extract username
        let input = r#"<m-user-mention>{"userId":"macro|chase@macro.com"}</m-user-mention> asdf"#;

        // Should keep the original text since the email field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_missing_field_document_mention() {
        // Missing "documentName" field which is used in the replacement
        let input = r#"<m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","blockParams":{},"collapsed":false}</m-document-mention> asdf"#;

        // Should keep the original text since the documentName field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_missing_field_date_mention() {
        // Missing "displayFormat" field which is used in the replacement
        let input = r#"<m-date-mention>{"date":"2025-12-01T05:00:00.000Z"}</m-date-mention>"#;

        // Should keep the original text since the displayFormat field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_partial_mentions_mixed() {
        // A message with a mix of valid and invalid mentions
        let input = r#"Valid user <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>
    and invalid user <m-user-mention>{"userId":"macro|invalid@macro.com"}</m-user-mention>
    and valid doc <m-document-mention>{"documentId":"123","blockName":"md","documentName":"Valid Doc","blockParams":{},"collapsed":false}</m-document-mention>
    and invalid doc <m-document-mention>{"documentId":"456","blockName":"md","blockParams":{},"collapsed":false}</m-document-mention>"#;

        // The valid mentions should be replaced, but invalid ones should remain unchanged
        let expected = r#"Valid user @chase
    and invalid user <m-user-mention>{"userId":"macro|invalid@macro.com"}</m-user-mention>
    and valid doc [Valid Doc]
    and invalid doc <m-document-mention>{"documentId":"456","blockName":"md","blockParams":{},"collapsed":false}</m-document-mention>"#;

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_same_text_and_url() {
        let input = r#"Check out this link <m-link>{"text":"https://www.example.com","url":"https://www.example.com"}</m-link> for more info"#;
        let expected = "Check out this link https://www.example.com for more info";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_different_text_and_url() {
        let input = r#"Visit <m-link>{"text":"Example Website","url":"https://www.example.com"}</m-link> today"#;
        let expected = "Visit [Example Website](https://www.example.com) today";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_multiple_link_mentions() {
        let input = r#"Check out <m-link>{"text":"Google","url":"https://google.com"}</m-link> and also <m-link>{"text":"https://github.com","url":"https://github.com"}</m-link>"#;
        let expected = "Check out [Google](https://google.com) and also https://github.com";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_empty_text() {
        let input = r#"Link: <m-link>{"text":"","url":"https://www.example.com"}</m-link>"#;
        let expected = "Link: [](https://www.example.com)";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_with_special_characters() {
        let input = r#"Complex link <m-link>{"text":"Search: \"hello world\"","url":"https://example.com?q=hello%20world&sort=date"}</m-link>"#;
        let expected = r#"Complex link [Search: "hello world"](https://example.com?q=hello%20world&sort=date)"#;

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_missing_text_field() {
        let input = r#"<m-link>{"url":"https://www.example.com"}</m-link> missing text field"#;

        // Should keep the original text since the text field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_sanitize_link_mention_missing_url_field() {
        let input = r#"<m-link>{"text":"Example Link"}</m-link> missing url field"#;

        // Should keep the original text since the url field is missing
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_sanitize_link_mention_invalid_json() {
        let input = r#"<m-link>{"text":"Example","url":INVALID}</m-link> invalid json"#;

        // Should keep the original text since the JSON is invalid
        let result = format_message_mentions(input);
        assert_eq!(result, input);
    }

    #[test]
    fn test_sanitize_mixed_mentions_with_links() {
        let input = r#"Hi <m-user-mention>{"userId":"macro|chase@macro.com","email":"chase@macro.com"}</m-user-mention>, check out <m-link>{"text":"Our Docs","url":"https://docs.example.com"}</m-link> and <m-document-mention>{"documentId":"6e01eaf5-f497-4b2e-96d0-ea3d527ef47d","blockName":"md","documentName":"Test Doc 34","blockParams":{},"collapsed":false}</m-document-mention> on <m-date-mention>{"date":"2025-12-01T05:00:00.000Z","displayFormat":"Mon, Dec 1, 2025"}</m-date-mention> or visit <m-link>{"text":"https://example.com","url":"https://example.com"}</m-link>"#;
        let expected = "Hi @chase, check out [Our Docs](https://docs.example.com) and [Test Doc 34] on Mon, Dec 1, 2025 or visit https://example.com";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_remove_mentions_includes_links() {
        let message = r#"Check out <m-link>{"text":"Example","url":"https://example.com"}</m-link> and <m-user-mention>{"userId":"macro|rithy@macro.com","email":"rithy@macro.com"}</m-user-mention> this doc <m-document-mention>{"documentId":"doc-1","blockName":"md","documentName":"Document 1","blockParams":{}}</m-document-mention>"#;

        // Note: Current remove_mentions_from_content doesn't handle links, so they remain
        let result = remove_mentions_from_content(message);
        let expected = r#"Check out <m-link>{"text":"Example","url":"https://example.com"}</m-link> and  this doc "#;

        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_markdown_characters_in_text() {
        let input = r#"Link with special chars <m-link>{"text":"[Already] (Markdown) *Format*","url":"https://example.com"}</m-link>"#;
        let expected =
            "Link with special chars [[Already] (Markdown) *Format*](https://example.com)";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }

    #[test]
    fn test_sanitize_link_mention_unicode_characters() {
        let input = r#"Unicode link <m-link>{"text":"测试链接 🔗","url":"https://example.com/测试"}</m-link>"#;
        let expected = "Unicode link [测试链接 🔗](https://example.com/测试)";

        let result = format_message_mentions(input);
        assert_eq!(result, expected);
    }
}
