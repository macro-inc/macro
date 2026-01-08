use crate::search::{
    builder::SearchQueryConfig,
    channels::{ChannelMessageIndex, ChannelMessageSearchConfig},
    chats::{ChatIndex, ChatSearchConfig},
    documents::{DocumentIndex, DocumentSearchConfig},
    emails::{EmailIndex, EmailSearchConfig},
    model::{
        Hit, NameIndex, SearchGotoChannel, SearchGotoChat, SearchGotoContent, SearchGotoDocument,
        SearchGotoEmail, SearchHit, parse_highlight_hit,
    },
    query::Keys,
};

use models_opensearch::SearchEntityType;

/// Possible search result indices for unified search
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub(crate) enum UnifiedSearchIndex {
    ChannelMessage(ChannelMessageIndex),
    Document(DocumentIndex),
    Chat(ChatIndex),
    Email(EmailIndex),
    Name(NameIndex),
}

pub struct SplitUnifiedSearchResponseValues {
    pub channel_message: Vec<SearchHit>,
    pub chat: Vec<SearchHit>,
    pub document: Vec<SearchHit>,
    pub email: Vec<SearchHit>,
    pub project: Vec<SearchHit>,
}

pub trait SplitUnifiedSearchResponse: Iterator<Item = SearchHit> {
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues;
}

impl<T> SplitUnifiedSearchResponse for T
where
    T: Iterator<Item = SearchHit>,
{
    fn split_search_response(self) -> SplitUnifiedSearchResponseValues {
        let (channel_message, chat, document, email, project) = self.into_iter().fold(
            (vec![], vec![], vec![], vec![], vec![]),
            |(mut channel_message, mut chat, mut document, mut email, mut project), item| {
                match item.entity_type {
                    SearchEntityType::Channels => {
                        channel_message.push(item);
                    }
                    SearchEntityType::Chats => {
                        chat.push(item);
                    }
                    SearchEntityType::Documents => {
                        document.push(item);
                    }
                    SearchEntityType::Emails => {
                        email.push(item);
                    }
                    SearchEntityType::Projects => {
                        project.push(item);
                    }
                }
                (channel_message, chat, document, email, project)
            },
        );

        SplitUnifiedSearchResponseValues {
            channel_message,
            chat,
            document,
            email,
            project,
        }
    }
}

impl From<Hit<UnifiedSearchIndex>> for SearchHit {
    fn from(index: Hit<UnifiedSearchIndex>) -> Self {
        match index.source {
            UnifiedSearchIndex::ChannelMessage(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Channels,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: ChannelMessageSearchConfig::TITLE_KEY,
                                content_key: ChannelMessageSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::Channels(SearchGotoChannel {
                    channel_message_id: a.message_id,
                    thread_id: a.thread_id,
                    sender_id: a.sender_id,
                    created_at: a.created_at_seconds,
                    updated_at: a.updated_at_seconds,
                })),
            },
            UnifiedSearchIndex::Document(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Documents,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: DocumentSearchConfig::TITLE_KEY,
                                content_key: DocumentSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::Documents(SearchGotoDocument {
                    node_id: a.node_id,
                    raw_content: a.raw_content,
                })),
            },
            UnifiedSearchIndex::Email(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Emails,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: EmailSearchConfig::TITLE_KEY,
                                content_key: EmailSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::Emails(SearchGotoEmail {
                    email_message_id: a.message_id,
                    bcc: a.bcc,
                    cc: a.cc,
                    labels: a.labels,
                    sent_at: a.sent_at_seconds,
                    sender: a.sender,
                    recipients: a.recipients,
                })),
            },

            UnifiedSearchIndex::Chat(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: SearchEntityType::Chats,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: ChatSearchConfig::TITLE_KEY,
                                content_key: ChatSearchConfig::CONTENT_KEY,
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: Some(SearchGotoContent::Chats(SearchGotoChat {
                    chat_message_id: a.chat_message_id,
                    role: a.role,
                })),
            },
            UnifiedSearchIndex::Name(a) => SearchHit {
                entity_id: a.entity_id,
                entity_type: a.entity_type,
                score: index.score,
                highlight: index
                    .highlight
                    .map(|h| {
                        parse_highlight_hit(
                            h,
                            Keys {
                                title_key: "name",
                                content_key: "",
                            },
                        )
                    })
                    .unwrap_or_default(),
                goto: None,
            },
        }
    }
}
