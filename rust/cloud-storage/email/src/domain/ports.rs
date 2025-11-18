use crate::domain::models::{
    Attachment, AttachmentMacro, Contact, EmailErr, EnrichedThreadPreviewCursor, GetEmailsRequest,
    PreviewCursorQuery, ThreadPreviewCursor,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{PaginatedCursor, SimpleSortMethod};
use uuid::Uuid;

pub trait EmailRepo: Send + Sync + 'static {
    type Err: Send;
    fn previews_for_view_cursor(
        &self,
        query: PreviewCursorQuery,
        user_id: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<ThreadPreviewCursor>, Self::Err>> + Send;

    fn attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Attachment>, Self::Err>> + Send;

    fn macro_attachments_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<AttachmentMacro>, Self::Err>> + Send;

    fn contacts_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Contact>, Self::Err>> + Send;
}

pub trait EmailService: Send + Sync + 'static {
    fn get_emails(
        &self,
        req: GetEmailsRequest,
    ) -> impl Future<
        Output = Result<
            PaginatedCursor<EnrichedThreadPreviewCursor, Uuid, SimpleSortMethod, ()>,
            EmailErr,
        >,
    > + Send;
}
