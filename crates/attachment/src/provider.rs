//! Attachment provider — routes [`Entity`] references to the correct
//! [`AttachmentService`] by [`EntityType`].

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use non_empty::NonEmpty;

use crate::{AttachmentContent, AttachmentService, Attachments, ResolutionError};

/// Routes [`Entity`] references to per-type [`AttachmentService`] implementations.
pub struct AttachmentProvider<Doc, Email, Chat, Chan, Sf> {
    /// Resolves [`EntityType::Document`] references.
    pub document: Doc,
    /// Resolves [`EntityType::EmailThread`] references.
    pub email_thread: Email,
    /// Resolves [`EntityType::Chat`] references.
    pub chat: Chat,
    /// Resolves [`EntityType::Channel`] references.
    pub channel: Chan,
    /// Resolves [`EntityType::StaticFile`] references.
    pub static_file: Sf,
}

impl<Doc, Email, Chat, Chan, Sf> AttachmentService
    for AttachmentProvider<Doc, Email, Chat, Chan, Sf>
where
    Doc: AttachmentService,
    Email: AttachmentService,
    Chat: AttachmentService,
    Chan: AttachmentService,
    Sf: AttachmentService,
{
    async fn resolve_attachments<'a>(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: NonEmpty<&[&'a Entity<'a>]>,
    ) -> Attachments<'a> {
        let mut doc = Vec::new();
        let mut email = Vec::new();
        let mut chat = Vec::new();
        let mut chan = Vec::new();
        let mut sf = Vec::new();

        for &entity in ids.iter() {
            match entity.entity_type {
                EntityType::Document | EntityType::Project => doc.push(entity),
                EntityType::StaticFile => sf.push(entity),
                EntityType::EmailThread => email.push(entity),
                EntityType::Chat => chat.push(entity),
                EntityType::Channel => chan.push(entity),
                _ => {}
            }
        }

        let (a, b, c, d, e) = futures::join!(
            dispatch(&self.document, user_id.clone(), &doc),
            dispatch(&self.email_thread, user_id.clone(), &email),
            dispatch(&self.chat, user_id.clone(), &chat),
            dispatch(&self.channel, user_id.clone(), &chan),
            dispatch(&self.static_file, user_id, &sf),
        );

        let mut results = Vec::with_capacity(a.len() + b.len() + c.len() + d.len() + e.len());
        results.extend(a);
        results.extend(b);
        results.extend(c);
        results.extend(d);
        results.extend(e);

        Attachments::new(NonEmpty::new(results).expect("entities was non-empty"))
    }
}

async fn dispatch<'a, S: AttachmentService>(
    service: &S,
    user_id: MacroUserIdStr<'_>,
    refs: &[&'a Entity<'a>],
) -> Vec<Result<AttachmentContent<'a>, ResolutionError>> {
    if refs.is_empty() {
        return Vec::new();
    }
    let ne = NonEmpty::new(refs).expect("checked non-empty");
    service
        .resolve_attachments(user_id, ne)
        .await
        .into_parts()
        .into_inner()
}
