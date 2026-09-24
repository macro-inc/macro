//! Toolset inbound adapter for Documents.

mod create_document;
mod edit_document;
mod read_content;
mod read_metadata;
mod rename_document;
mod reply_to_document_comment;
mod resolve_document_comment;
mod spreadsheet;
mod upload_file;

#[cfg(test)]
mod comment_test;
#[cfg(test)]
mod test;

use crate::{
    domain::comments::{DocumentCommentReader, DocumentComments},
    domain::create::DocumentCreator,
    domain::ports::DocumentService,
    domain::ports::create::DocumentCreationService,
    domain::ports::editing::EditingWorkerService,
    domain::ports::mentions::NoOpDocumentMentionTracker,
    inbound::toolset::{
        create_document::CreateDocument,
        edit_document::EditDocument,
        read_content::ReadContent,
        read_metadata::ReadMetadata,
        rename_document::RenameDocument,
        reply_to_document_comment::ReplyToDocumentComment,
        resolve_document_comment::ResolveDocumentComment,
        spreadsheet::{CalculateSpreadsheet, EditSpreadsheet, ReadSpreadsheet},
        upload_file::UploadFile,
    },
    outbound::{
        document_bytes_upload::ReqwestDocumentBytesUploader,
        lexical_comment_marks::LexicalCommentMarks, markdown_init::LexicalSyncMarkdownInitializer,
    },
};
use activity::{Actor, Attribution};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError};
use bot_id::BotId;
use entity_access::domain::{
    models::{AccessError, BotAccessScope, EntityAccessReceipt, EntityType},
    ports::EntityAccessService,
};
use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{api::MessageServiceApi, ports::MessageError, service::MessageWrite};
use std::sync::Arc;
use sync_service_client::SyncServiceClient;
use uuid::Uuid;

/// Default backend-owned document creation use case for document tools.
pub type DefaultDocumentToolCreator<DSvc> = DocumentCreator<
    Arc<DSvc>,
    LexicalSyncMarkdownInitializer,
    ReqwestDocumentBytesUploader,
    NoOpDocumentMentionTracker,
>;

/// Service context for document AI tools
pub struct DocumentToolContext<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> {
    /// The document service instance
    pub service: Arc<DSvc>,
    /// The entity access service instance
    pub entity_access_service: Arc<ESvc>,

    /// The lexical client
    pub lexical_client: Arc<LexicalClient>,

    /// The sync-service client
    pub sync_service_client: Arc<SyncServiceClient>,

    /// Backend-owned document creation use case.
    pub creator: DefaultDocumentToolCreator<DSvc>,

    /// Editing worker service for the EditDocument tool.
    pub editing: Arc<EDSvc>,

    /// A document's comment threads, read by the ReadContent tool.
    pub comments: Arc<dyn DocumentComments>,

    /// Shared message service the comment tools reply and resolve through.
    pub messages: Arc<dyn MessageServiceApi>,

    /// Permission-scoped deterministic spreadsheet workflows.
    pub spreadsheet: Arc<crate::domain::spreadsheet::SpreadsheetService<DSvc, EDSvc>>,

    /// JWT secret used to mint document permission tokens for the editing worker.
    pub document_permission_jwt_secret: String,

    /// Records the token usage the editing worker reports. Defaults to a no-op;
    /// the chat path injects the real (Postgres-backed) recorder per request.
    pub recorder: Arc<dyn ai_usage::UsageRecorder>,

    /// The bot these tools act as, on behalf of the requesting user. Defaults
    /// to Macro AI; hosts running a specific agent set it with [`Self::with_actor`].
    pub actor: BotId,
}

impl<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> Clone for DocumentToolContext<DSvc, ESvc, EDSvc>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            lexical_client: self.lexical_client.clone(),
            sync_service_client: self.sync_service_client.clone(),
            creator: self.creator.clone(),
            editing: self.editing.clone(),
            comments: self.comments.clone(),
            messages: self.messages.clone(),
            spreadsheet: self.spreadsheet.clone(),
            document_permission_jwt_secret: self.document_permission_jwt_secret.clone(),
            recorder: self.recorder.clone(),
            actor: self.actor,
        }
    }
}

impl<
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
> DocumentToolContext<DSvc, ESvc, EDSvc>
{
    /// Create a new document tool context
    pub fn new(
        service: DSvc,
        entity_access_service: ESvc,
        lexical_client: LexicalClient,
        sync_service_client: SyncServiceClient,
        editing: EDSvc,
        document_permission_jwt_secret: String,
        messages: Arc<dyn MessageServiceApi>,
    ) -> Self {
        let service = Arc::new(service);
        let lexical_client = Arc::new(lexical_client);
        let sync_service_client = Arc::new(sync_service_client);
        let creator = DocumentCreator::new(
            service.clone(),
            LexicalSyncMarkdownInitializer::new(
                lexical_client.as_ref().clone(),
                sync_service_client.as_ref().clone(),
            ),
            ReqwestDocumentBytesUploader::default(),
            NoOpDocumentMentionTracker,
        );
        let comments = Arc::new(DocumentCommentReader::new(
            messages.clone(),
            LexicalCommentMarks::new(lexical_client.clone()),
        ));
        let editing = Arc::new(editing);
        let spreadsheet = Arc::new(crate::domain::spreadsheet::SpreadsheetService::new(
            service.clone(),
            editing.clone(),
            document_permission_jwt_secret.clone(),
        ));

        Self {
            service,
            entity_access_service: Arc::new(entity_access_service),
            lexical_client,
            sync_service_client,
            creator,
            editing,
            comments,
            messages,
            spreadsheet,
            document_permission_jwt_secret,
            recorder: Arc::new(ai_usage::NoOpUsageRecorder),
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Set the usage recorder the EditDocument tool logs worker token usage to.
    pub fn with_recorder(mut self, recorder: Arc<dyn ai_usage::UsageRecorder>) -> Self {
        self.recorder = recorder;
        self
    }

    /// Set the bot these tools act as.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }

    /// Mint the bot's comment capability on the document on behalf of the
    /// requesting user: the same comment access the web composer requires.
    pub async fn require_comment_write(
        &self,
        request_context: &RequestContext,
        document_id: Uuid,
    ) -> Result<EntityAccessReceipt<MessageWrite>, ToolCallError> {
        self.entity_access_service
            .generate_bot_entity_access_receipt::<MessageWrite>(
                self.actor,
                BotAccessScope::user(request_context.user_id.clone()),
                &document_id.to_string(),
                EntityType::Document,
            )
            .await
            .map_err(comment_access_error)
    }

    /// Attribution for a write these tools make for `user`.
    pub fn attribution(&self, user: MacroUserIdStr<'static>) -> Attribution {
        Attribution::delegated(Actor::new_from_bot(self.actor), user)
    }
}

/// Create a document toolset
pub fn document_toolset<DSvc, ESvc, EDSvc>()
-> AsyncToolCollection<DocumentToolContext<DSvc, ESvc, EDSvc>>
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    AsyncToolCollection::new()
        .add_tool::<ReadMetadata, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<ReadContent, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<CreateDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<UploadFile, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<RenameDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<EditDocument, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<ReplyToDocumentComment, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<ResolveDocumentComment, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<ReadSpreadsheet, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<CalculateSpreadsheet, DocumentToolContext<DSvc, ESvc, EDSvc>>()
        .add_tool::<EditSpreadsheet, DocumentToolContext<DSvc, ESvc, EDSvc>>()
}

fn comment_access_error(err: AccessError) -> ToolCallError {
    let description = match err {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            "you need comment access to the document to comment on it"
        }
        AccessError::NotFound(_) => "document not found",
        AccessError::BadRequest(_) => "invalid document id",
        AccessError::Unavailable(_) | AccessError::Internal(_) => {
            "failed to verify access to the document"
        }
    };
    ToolCallError {
        description: description.to_string(),
        internal_error: err.into(),
    }
}

fn comment_error(description: &'static str) -> impl FnOnce(MessageError) -> ToolCallError {
    move |err| {
        let description = match &err {
            MessageError::NotFound => "comment thread not found on this document".to_string(),
            MessageError::Forbidden => {
                "you need comment access to the document to comment on it".to_string()
            }
            MessageError::Invalid(reason) => format!("{description}: {reason}"),
            MessageError::Conflict => format!("{description}: message id already exists"),
            MessageError::Repository(_) => description.to_string(),
        };
        ToolCallError {
            description,
            internal_error: anyhow::Error::new(err),
        }
    }
}
