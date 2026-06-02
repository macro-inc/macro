//! Task embedding
use crate::Embeddable;
use std::borrow::Cow;

static TITLE: &str = "title";
static BODY: &str = "body";

/// A task
pub struct Task<'a> {
    /// task name
    pub title: Cow<'a, str>,
    /// task body
    pub body: Cow<'a, str>,
}

impl<'a> Embeddable for Task<'a> {
    fn embedding_content(&self) -> Vec<(crate::SearchKey, crate::Content<'a>)> {
        let mut fields = Vec::with_capacity(2);
        if !self.title.trim().is_empty() {
            fields.push((TITLE, self.title.clone()));
        }
        if !self.body.trim().is_empty() {
            fields.push((BODY, self.body.clone()));
        }
        fields
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keys_and_text(task: &Task<'_>) -> Vec<(&'static str, String)> {
        task.embedding_content()
            .into_iter()
            .map(|(key, text)| (key, text.into_owned()))
            .collect()
    }

    #[test]
    fn embeds_title_when_task_has_no_body() {
        let task = Task {
            title: Cow::Borrowed("Title"),
            body: Cow::Borrowed(""),
        };

        assert_eq!(keys_and_text(&task), vec![("title", "Title".to_string())]);
    }

    #[test]
    fn embeds_body_when_task_has_no_title() {
        let task = Task {
            title: Cow::Borrowed(""),
            body: Cow::Borrowed("Body"),
        };

        assert_eq!(keys_and_text(&task), vec![("body", "Body".to_string())]);
    }

    #[test]
    fn embeds_nothing_when_task_has_no_title_or_body() {
        let task = Task {
            title: Cow::Borrowed(" "),
            body: Cow::Borrowed("\n\t"),
        };

        assert!(keys_and_text(&task).is_empty());
    }
}
