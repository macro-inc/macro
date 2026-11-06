#![deny(missing_docs)]
//! This crate contains model information for the user quota

/// The UserQuota represents the user's current quota
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, utoipa::ToSchema)]
pub struct UserQuota {
    /// The user's total number of documents they have created.
    pub documents: i64,
    /// The user's total number of AI chat messages the user has sent.
    pub ai_chat_messages: i64,
    /// The maximum number of documents they can create.
    pub max_documents: u32,
    /// The maximum number of AI chat messages they can send.
    pub max_ai_chat_messages: u32,
}

/// Stores a user's current quota
#[derive(Debug)]
pub struct CreateUserQuotaRequest {
    /// The user's total number of documents they have created.
    pub documents: i64,
    /// The user's total number of AI chat messages the user has sent.
    pub ai_chat_messages: i64,
}

impl From<CreateUserQuotaRequest> for UserQuota {
    fn from(request: CreateUserQuotaRequest) -> Self {
        Self {
            documents: request.documents,
            ai_chat_messages: request.ai_chat_messages,
            max_documents: MAXIMUM_USER_QUOTA.documents(),
            max_ai_chat_messages: MAXIMUM_USER_QUOTA.ai_chat_messages(),
        }
    }
}

/// The maximum quota for creation of various entities
pub struct MaximumUserQuota {
    pub(crate) documents: u32,
    pub(crate) ai_chat_messages: u32,
}

impl MaximumUserQuota {
    /// Get the maximum number of documents a user can create
    pub fn documents(&self) -> u32 {
        self.documents
    }

    /// Get the maximum number of AI chat messages a user can send
    pub fn ai_chat_messages(&self) -> u32 {
        self.ai_chat_messages
    }
}

/// A static instance of the maximum quota for creation of various entities
/// This can be used for checking if a user has reached their quota
pub static MAXIMUM_USER_QUOTA: MaximumUserQuota = MaximumUserQuota {
    documents: 10,
    ai_chat_messages: 10,
};
