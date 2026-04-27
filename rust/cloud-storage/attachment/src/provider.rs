//! Attachment provider — a router that dispatches [`AttachmentReference`]s
//! to the correct [`AttachmentService`] by variant.

use macro_user_id::user_id::MacroUserIdStr;
use non_empty::NonEmpty;

use crate::{
    AttachmentContent, AttachmentReference, AttachmentService, Attachments, ResolutionError,
};

/// Routes [`AttachmentReference`]s to per-variant [`AttachmentService`] implementations.
pub struct AttachmentProvider<Dss, Sfs, Email, Chat, Chan> {
    /// Resolves [`AttachmentReference::DssFile`] references.
    pub dss_file: Dss,
    /// Resolves [`AttachmentReference::SfsImage`] references.
    pub sfs_image: Sfs,
    /// Resolves [`AttachmentReference::EmailThread`] references.
    pub email_thread: Email,
    /// Resolves [`AttachmentReference::Chat`] references.
    pub chat: Chat,
    /// Resolves [`AttachmentReference::Channel`] references.
    pub channel: Chan,
}

impl<Dss, Sfs, Email, Chat, Chan> AttachmentProvider<Dss, Sfs, Email, Chat, Chan>
where
    Dss: AttachmentService,
    Sfs: AttachmentService,
    Email: AttachmentService,
    Chat: AttachmentService,
    Chan: AttachmentService,
{
    /// Resolve a batch of references, routing each to the service for
    /// its variant. Groups are dispatched concurrently.
    pub async fn resolve(
        &self,
        user_id: MacroUserIdStr<'_>,
        references: NonEmpty<Vec<AttachmentReference>>,
    ) -> Attachments {
        let mut dss_ids = Vec::new();
        let mut sfs_ids = Vec::new();
        let mut email_ids = Vec::new();
        let mut chat_ids = Vec::new();
        let mut chan_ids = Vec::new();

        for r in references.into_inner() {
            match r {
                AttachmentReference::DssFile { id } => dss_ids.push(id),
                AttachmentReference::SfsImage { url } => sfs_ids.push(url),
                AttachmentReference::EmailThread { id } => email_ids.push(id),
                AttachmentReference::Chat { id } => chat_ids.push(id),
                AttachmentReference::Channel { id } => chan_ids.push(id),
            }
        }

        let (a, b, c, d, e) = futures::join!(
            dispatch(&self.dss_file, user_id.clone(), dss_ids),
            dispatch(&self.sfs_image, user_id.clone(), sfs_ids),
            dispatch(&self.email_thread, user_id.clone(), email_ids),
            dispatch(&self.chat, user_id.clone(), chat_ids),
            dispatch(&self.channel, user_id, chan_ids),
        );

        let mut results = Vec::with_capacity(a.len() + b.len() + c.len() + d.len() + e.len());
        results.extend(a);
        results.extend(b);
        results.extend(c);
        results.extend(d);
        results.extend(e);

        Attachments::new(NonEmpty::new(results).expect("references was non-empty"))
    }
}

async fn dispatch<S: AttachmentService>(
    service: &S,
    user_id: MacroUserIdStr<'_>,
    ids: Vec<String>,
) -> Vec<Result<AttachmentContent, ResolutionError>> {
    if ids.is_empty() {
        return Vec::new();
    }
    let refs: Vec<&str> = ids.iter().map(|s| s.as_str()).collect();
    let ne = NonEmpty::new(refs.as_slice()).expect("checked non-empty");
    service
        .resolve_attachments(user_id, ne)
        .await
        .into_parts()
        .into_inner()
}
