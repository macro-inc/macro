#[derive(Clone, Debug)]
pub struct ProjectModifiedArgs<T>
where
    T: Clone + std::fmt::Debug + ToString + std::marker::Send + Sync,
{
    /// The new project id of the item or the project that was modified
    pub project_id: Option<T>,
    /// The old project id if the item was moved
    pub old_project_id: Option<T>,
    /// The user who performed the action
    pub user_id: String,
}

#[tracing::instrument(skip(db, macro_notify_client))]
pub async fn update_project_modified<'a, T>(
    db: &'a sqlx::Pool<sqlx::Postgres>,
    macro_notify_client: &'a macro_notify::MacroNotifyClient,
    project_modified_args: ProjectModifiedArgs<T>,
) where
    T: Clone + std::fmt::Debug + ToString + std::marker::Send + Sync,
{
    tracing::trace!("updating project modified date");

    let project_id = project_modified_args
        .project_id
        .as_ref()
        .map(|s| s.to_string());
    let old_project_id = project_modified_args
        .old_project_id
        .as_ref()
        .map(|s| s.to_string());

    let user_id = project_modified_args.user_id.clone();

    tokio::spawn({
        let db = db.clone();
        let _macro_notify_client = macro_notify_client.clone();
        let project_id = project_id.clone();
        let old_project_id = old_project_id.clone();
        let _user_id = user_id.clone();
        async move {
            if let Some(old_project_id) = old_project_id
                && !old_project_id.is_empty()
            {
                tracing::trace!(project_id=?old_project_id, "updating project modified date");
                let _ = macro_db_client::projects::update_project_modified_date(&db, &old_project_id).await.inspect_err(|e| {
                        tracing::error!(error=?e, project_id=?old_project_id, "unable to update project modified date");
                    });

                // TODO: [BAC-44] Should use connection gateway
                // let _ = macro_notify_client
                //     .send_notification(
                //         NotificationEventType::ProjectModified,
                //         &MessageBodyWithParticipantInfo {
                //             event_item_id: old_project_id.clone(),
                //             event_item_type: "project".to_string(),
                //             sender_id: Some(user_id.clone()),
                //             recipient_ids: None,
                //             metadata: None,
                //             is_important_v0: Some(false),
                //         },
                //     )
                //     .await
                //     .inspect_err(|e| {
                //         tracing::error!(error=?e, "unable to send project update message");
                //     });
            }

            if let Some(project_id) = project_id
                && !project_id.is_empty()
            {
                tracing::trace!(project_id=?project_id, "updating project modified date");

                let _ = macro_db_client::projects::update_project_modified_date(&db, &project_id).await.inspect_err(|e| {
                        tracing::error!(error=?e, project_id=?project_id, "unable to update project modified date");
                    });

                // TODO: [BAC-44] Should use connection gateway
                // let _ = macro_notify_client
                //     .send_notification(
                //         NotificationEventType::ProjectModified,
                //         &MessageBodyWithParticipantInfo {
                //             event_item_id: project_id.clone(),
                //             event_item_type: "project".to_string(),
                //             sender_id: Some(user_id.clone()),
                //             recipient_ids: None,
                //             metadata: None,
                //             is_important_v0: Some(false),
                //         },
                //     )
                //     .await
                //     .inspect_err(|e| {
                //         tracing::error!(error=?e, "unable to send project update message");
                //     });
            }
        }
    });
}
