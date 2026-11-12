use super::*;

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Read a root with the same live-thread policy as an individual REST message.
    #[tracing::instrument(err, skip(self, access), name = "messages.get_root", fields(root_id = %root_id))]
    pub async fn get_root(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root_id: Uuid,
    ) -> Result<MessageTimelineEntry, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        self.active_thread(&parent, root_id).await?;
        let root = self
            .repo
            .root(&parent, root_id)
            .await?
            .ok_or(MessageError::NotFound)?;
        if root.message.kind == MessageKind::CallRoot {
            let status = self
                .repo
                .call_entry_statuses(&[root_id])
                .await?
                .remove(&root_id)
                .unwrap_or(CallEntryStatus::RecordDeleted);
            Ok(MessageTimelineEntry::Call {
                message: Box::new(root),
                status,
            })
        } else {
            Ok(MessageTimelineEntry::Message {
                message: Box::new(root),
            })
        }
    }

    /// Read live replies in bounded display-order windows under full-thread access.
    #[tracing::instrument(err, skip(self, access), name = "messages.thread_page", fields(root_id = %root_id))]
    pub async fn thread_page(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root_id: Uuid,
        mut query: MessageThreadQuery,
    ) -> Result<MessageThreadPage, MessageError> {
        if query.around.is_some() && query.cursor.is_some() {
            return Err(MessageError::Invalid("invalid thread selection"));
        }
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        self.active_thread(&parent, root_id).await?;
        query.limit = Some(query.limit.unwrap_or(50).clamp(1, 100));
        let mut page = self.repo.thread_page(&parent, root_id, query).await?;
        if page.root.message.kind == MessageKind::CallRoot {
            page.call = Some(
                self.repo
                    .call_entry_statuses(&[root_id])
                    .await?
                    .remove(&root_id)
                    .unwrap_or(CallEntryStatus::RecordDeleted),
            );
        }
        Ok(page)
    }
}
