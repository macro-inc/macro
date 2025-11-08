use ai_format::{Indent, InsightContextLog, Truncate, format_date};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone)]
pub struct ChatContext(pub Vec<Conversation>);

#[derive(Debug, Clone)]
pub struct Conversation {
    pub conversation_title: String,
    pub messages: Vec<UserMessage>,
}

#[derive(Debug, Clone)]
pub struct UserMessage {
    pub content: String,
    pub date: DateTime<Utc>,
    pub attachment_insights: Vec<AttachmentInsight>,
}

#[derive(Debug, Clone)]
pub enum AttachmentInsight {
    Document {
        title: String,
        file_type: String,
        summary: String,
    },
}

const INDENT_LEVEL: usize = 2;
impl From<ChatContext> for InsightContextLog<String> {
    fn from(value: ChatContext) -> Self {
        let content = value
            .0
            .into_iter()
            .map(Into::into)
            .collect::<Vec<InsightContextLog<_>>>()
            .into_iter()
            .map(|log| Indent(log, INDENT_LEVEL).to_string())
            .collect::<Vec<_>>()
            .join("\n");
        InsightContextLog {
            content,
            metadata: vec![],
            name: "ChatBot Conversations".to_string(),
        }
    }
}

impl From<Conversation> for InsightContextLog<String> {
    fn from(value: Conversation) -> Self {
        let content = value
            .messages
            .into_iter()
            .map(Into::into)
            .collect::<Vec<InsightContextLog<_>>>()
            .into_iter()
            .map(|log| Indent(log, INDENT_LEVEL).to_string())
            .collect::<Vec<_>>()
            .join("\n");

        InsightContextLog {
            content,
            metadata: vec![("conversation_title".to_string(), value.conversation_title)],
            name: "ChatBot Conversation".to_string(),
        }
    }
}

impl From<UserMessage> for InsightContextLog<String> {
    fn from(value: UserMessage) -> Self {
        let attachments = value
            .attachment_insights
            .into_iter()
            .map(|attachment| attachment.into())
            .collect::<Vec<InsightContextLog<_>>>()
            .into_iter()
            .map(|log| log.to_string())
            .collect::<Vec<_>>()
            .join("");

        let content = format!(
            "{}\n{}",
            Truncate(value.content, 5000),
            Indent(attachments, INDENT_LEVEL)
        );

        InsightContextLog {
            name: "User Message".to_string(),
            metadata: vec![("date".to_string(), format_date(value.date))],
            content,
        }
    }
}

impl From<AttachmentInsight> for InsightContextLog<Truncate<String>> {
    fn from(value: AttachmentInsight) -> Self {
        match value {
            AttachmentInsight::Document {
                title,
                file_type,
                summary,
                ..
            } => InsightContextLog {
                name: "Document Attachment".to_string(),
                metadata: vec![
                    ("title".to_string(), title),
                    ("file_type".to_string(), file_type),
                ],
                content: Truncate(summary, 400),
            },
        }
    }
}

#[cfg(test)]
mod test {
    use crate::insight_context::chat::*;
    use chrono::{DateTime, TimeZone, Utc};

    fn now() -> DateTime<Utc> {
        Utc.ymd(2025, 5, 9).and_hms(10, 48, 30)
    }

    #[test]
    fn test_format_attachment() {
        let attachment = AttachmentInsight::Document {
            file_type: "md".to_string(),
            summary: "a file".to_string(),
            title: "stuff todo".to_string(),
        };
        let log = InsightContextLog::from(attachment).to_string();
        assert_eq!(
            r#"[Document Attachment]
title: stuff todo, file_type: md
a file
[END Document Attachment]
"#
            .to_string(),
            log
        );
    }

    #[test]
    fn test_format_user_message() {
        let attachment = AttachmentInsight::Document {
            file_type: "md".to_string(),
            summary: "a file".to_string(),
            title: "stuff todo".to_string(),
        };
        let user_message = UserMessage {
            attachment_insights: vec![attachment.clone(), attachment],
            content: "compare these documents".to_string(),
            date: now(),
        };
        let log = InsightContextLog::from(user_message);
        assert_eq!(
            r#"[User Message]
date: 2025-05-09
compare these documents
  [Document Attachment]
  title: stuff todo, file_type: md
  a file
  [END Document Attachment]
  [Document Attachment]
  title: stuff todo, file_type: md
  a file
  [END Document Attachment]
[END User Message]
"#
            .to_string(),
            log.to_string()
        )
    }
    #[test]
    fn test_format_conversation() {
        let attachment = AttachmentInsight::Document {
            file_type: "md".to_string(),
            summary: "a file".to_string(),
            title: "stuff todo".to_string(),
        };
        let user_message = UserMessage {
            attachment_insights: vec![attachment.clone(), attachment],
            content: "compare these documents".to_string(),
            date: now(),
        };
        let conversation = Conversation {
            conversation_title: "text convo".to_string(),
            messages: vec![user_message.clone(), user_message],
        };
        let log = InsightContextLog::from(conversation);
        assert_eq!(
            r#"[ChatBot Conversation]
conversation_title: text convo
  [User Message]
  date: 2025-05-09
  compare these documents
    [Document Attachment]
    title: stuff todo, file_type: md
    a file
    [END Document Attachment]
    [Document Attachment]
    title: stuff todo, file_type: md
    a file
    [END Document Attachment]
  [END User Message]
  [User Message]
  date: 2025-05-09
  compare these documents
    [Document Attachment]
    title: stuff todo, file_type: md
    a file
    [END Document Attachment]
    [Document Attachment]
    title: stuff todo, file_type: md
    a file
    [END Document Attachment]
  [END User Message]
[END ChatBot Conversation]
"#
            .to_string(),
            log.to_string()
        );
    }

    #[test]
    fn test_format_context() {
        let attachment = AttachmentInsight::Document {
            file_type: "md".to_string(),
            summary: "a file".to_string(),
            title: "stuff todo".to_string(),
        };
        let user_message = UserMessage {
            attachment_insights: vec![attachment.clone(), attachment],
            content: "compare these documents".to_string(),
            date: now(),
        };
        let conversation = Conversation {
            conversation_title: "text convo".to_string(),
            messages: vec![user_message.clone(), user_message],
        };
        let context = ChatContext(vec![conversation.clone(), conversation]);
        let log = InsightContextLog::from(context);
        assert_eq!(
            r#"[ChatBot Conversations]
  [ChatBot Conversation]
  conversation_title: text convo
    [User Message]
    date: 2025-05-09
    compare these documents
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
    [END User Message]
    [User Message]
    date: 2025-05-09
    compare these documents
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
    [END User Message]
  [END ChatBot Conversation]
  [ChatBot Conversation]
  conversation_title: text convo
    [User Message]
    date: 2025-05-09
    compare these documents
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
    [END User Message]
    [User Message]
    date: 2025-05-09
    compare these documents
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
      [Document Attachment]
      title: stuff todo, file_type: md
      a file
      [END Document Attachment]
    [END User Message]
  [END ChatBot Conversation]
[END ChatBot Conversations]
"#
            .to_string(),
            log.to_string()
        );
    }
}
