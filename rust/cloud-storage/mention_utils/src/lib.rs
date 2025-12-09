use anyhow::Context;
use regex::Regex;
use serde::Deserialize;

pub mod parse;

#[cfg(test)]
mod tests;

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
