// use models_search::{
//     ItemId, Metadata,
//     channel::{ChannelSearchMetadata, ChannelSearchResult},
//     chat::{ChatMessageSearchResult, ChatSearchMetadata},
//     document::{DocumentSearchMetadata, DocumentSearchResult},
//     email::{EmailSearchMetadata, EmailSearchResult},
//     project::{ProjectSearchMetadata, ProjectSearchResult},
// };
//
// /// Response from OpenSearch for individual chat search results
// #[derive(Debug, serde::Serialize, serde::Deserialize)]
// pub struct ChatOpenSearchResponse {
//     pub inner: ChatSearchResponse,
// }
//
// impl ItemId for ChatOpenSearchResponse {
//     fn get_id(&self) -> &String {
//         &self.inner.chat_id
//     }
// }
//
// impl From<&ChatOpenSearchResponse> for Option<ChatMessageSearchResult> {
//     fn from(response: &ChatOpenSearchResponse) -> Self {
//         Some(ChatMessageSearchResult {
//             chat_message_id: response.inner.chat_message_id.clone(),
//             role: response.inner.role.clone(),
//             highlight: response.inner.highlight.clone().into(),
//             updated_at: response.inner.updated_at,
//             title: response.inner.title.clone(),
//             score: response.inner.score,
//         })
//     }
// }
//
// impl Metadata<ChatSearchMetadata> for ChatOpenSearchResponse {
//     fn metadata(&self, id: &str) -> ChatSearchMetadata {
//         ChatSearchMetadata {
//             chat_id: id.to_string(),
//             user_id: self.inner.user_id.clone(),
//             title: self.inner.title.clone(),
//         }
//     }
// }
//
// /// Response from OpenSearch for individual project search results
// #[derive(Debug, serde::Serialize, serde::Deserialize)]
// pub struct ProjectOpenSearchResponse {
//     pub inner: ProjectSearchResponse,
// }
//
// impl ItemId for ProjectOpenSearchResponse {
//     fn get_id(&self) -> &String {
//         &self.inner.project_id
//     }
// }
//
// impl Metadata<ProjectSearchMetadata> for ProjectOpenSearchResponse {
//     fn metadata(&self, id: &str) -> ProjectSearchMetadata {
//         ProjectSearchMetadata {
//             project_id: id.to_string(),
//             updated_at: self.inner.updated_at,
//             created_at: self.inner.created_at,
//             project_name: self.inner.project_name.clone(),
//             owner_id: self.inner.user_id.clone(),
//         }
//     }
// }
//
// impl From<&ProjectOpenSearchResponse> for Option<ProjectSearchResult> {
//     fn from(response: &ProjectOpenSearchResponse) -> Self {
//         Some(ProjectSearchResult {
//             highlight: response.inner.highlight.clone().into(),
//             score: response.inner.score,
//         })
//     }
// }
// // Document
//
// /// Response from OpenSearch for individual document search results
// #[derive(Debug, serde::Serialize, serde::Deserialize)]
// pub struct DocumentOpenSearchResponse {
//     pub inner: DocumentSearchResponse,
// }
//
// impl Metadata<DocumentSearchMetadata> for DocumentOpenSearchResponse {
//     fn metadata(&self, id: &str) -> DocumentSearchMetadata {
//         DocumentSearchMetadata {
//             document_id: id.to_string(),
//             document_name: self.inner.document_name.clone(),
//             owner_id: self.inner.owner_id.clone(),
//             file_type: self.inner.file_type.clone(),
//         }
//     }
// }
//
// impl ItemId for DocumentOpenSearchResponse {
//     fn get_id(&self) -> &String {
//         &self.inner.document_id
//     }
// }
//
// impl From<&DocumentOpenSearchResponse> for Option<DocumentSearchResult> {
//     fn from(response: &DocumentOpenSearchResponse) -> Self {
//         Some(DocumentSearchResult {
//             node_id: response.inner.node_id.clone(),
//             raw_content: response.inner.raw_content.clone(),
//             updated_at: response.inner.updated_at,
//             highlight: response.inner.highlight.clone().into(),
//             score: response.inner.score,
//         })
//     }
// }
//
// // Email
//
// /// Response from OpenSearch for individual email search results
// #[derive(Debug, serde::Serialize, serde::Deserialize)]
// pub struct EmailOpenSearchResponse {
//     pub inner: EmailSearchResponse,
// }
//
// impl Metadata<EmailSearchMetadata> for EmailOpenSearchResponse {
//     fn metadata(&self, id: &str) -> EmailSearchMetadata {
//         EmailSearchMetadata {
//             thread_id: id.to_string(),
//             user_id: self.inner.user_id.clone(),
//         }
//     }
// }
//
// impl ItemId for EmailOpenSearchResponse {
//     fn get_id(&self) -> &String {
//         &self.inner.thread_id
//     }
// }
//
// impl From<&EmailOpenSearchResponse> for Option<EmailSearchResult> {
//     fn from(response: &EmailOpenSearchResponse) -> Self {
//         Some(EmailSearchResult {
//             message_id: response.inner.message_id.clone(),
//             subject: response.inner.subject.clone(),
//             sender: response.inner.sender.clone(),
//             recipients: response.inner.recipients.clone(),
//             cc: response.inner.cc.clone(),
//             bcc: response.inner.bcc.clone(),
//             labels: response.inner.labels.clone(),
//             highlight: response.inner.highlight.clone().into(),
//             updated_at: response.inner.updated_at,
//             sent_at: response.inner.sent_at,
//             score: response.inner.score,
//         })
//     }
// }
//
// // Channel
//
// /// Response from OpenSearch for individual email search results
// #[derive(Debug, serde::Serialize, serde::Deserialize)]
// pub struct ChannelOpenSearchResponse {
//     pub inner: ChannelMessageSearchResponse,
// }
//
// impl Metadata<ChannelSearchMetadata> for ChannelOpenSearchResponse {
//     fn metadata(&self, id: &str) -> ChannelSearchMetadata {
//         ChannelSearchMetadata {
//             channel_id: id.to_string(),
//             channel_type: self.inner.channel_type.clone(),
//         }
//     }
// }
//
// impl ItemId for ChannelOpenSearchResponse {
//     fn get_id(&self) -> &String {
//         &self.inner.channel_id
//     }
// }
//
// impl From<&ChannelOpenSearchResponse> for Option<ChannelSearchResult> {
//     fn from(response: &ChannelOpenSearchResponse) -> Self {
//         Some(ChannelSearchResult {
//             message_id: response.inner.message_id.clone(),
//             thread_id: response.inner.thread_id.clone(),
//             sender_id: response.inner.sender_id.clone(),
//             highlight: response.inner.highlight.clone().into(),
//             updated_at: response.inner.updated_at,
//             created_at: response.inner.created_at,
//             score: response.inner.score,
//         })
//     }
// }
