use crate::domain::models::{
    Attachment, AttachmentMacro, Contact, EmailErr, EmailThreadPreview, EnrichedEmailThreadPreview,
    GetEmailsRequest, Label, Link, PreviewCursorQuery, UserProvider,
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
    ) -> impl Future<Output = Result<Vec<EmailThreadPreview>, Self::Err>> + Send;

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

    fn labels_by_thread_ids(
        &self,
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Label>, Self::Err>> + Send;

    fn link_by_fusionauth_and_macro_id(
        &self,
        fusionauth_user_id: &str,
        macro_id: MacroUserIdStr<'_>,
        provider: UserProvider,
    ) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
}

pub trait EmailService: Send + Sync + 'static {
    fn get_email_thread_previews(
        &self,
        req: GetEmailsRequest,
    ) -> impl Future<
        Output = Result<
            PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>,
            EmailErr,
        >,
    > + Send;

    fn get_link_by_auth_id_and_macro_id(
        &self,
        auth_id: &str,
        macro_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Link>, EmailErr>> + Send;
}
