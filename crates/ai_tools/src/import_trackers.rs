//! Reviewed tracker writes through the owning project, document and property
//! services. Authorization stays in those services and typed access receipts.

use crate::{ToolEntityCreator, tool_context::ImportedContent};
use documents::domain::ports::DocumentService;
use documents::domain::ports::TaskPropertiesPort;
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use import::domain::ports::{
    ImportedDocumentProperties, ImportedTaskProperties, TrackerTaskRelations,
};
use initiative::domain::models::{CreateInitiativeRequest, InitiativeId};
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::{EntityReference, EntityType, api::SetPropertyValue};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

impl ToolEntityCreator {
    #[tracing::instrument(skip_all, fields(project_id = %id), err)]
    pub(crate) async fn create_tracker_project_impl(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        shared: bool,
    ) -> anyhow::Result<Uuid> {
        let project = self
            .initiative_service
            .create_imported(
                user,
                CreateInitiativeRequest {
                    name: name.to_string(),
                    description: Some(markdown.to_string()),
                    member_ids: None,
                    share_with_team: Some(shared),
                    property_values: Vec::new(),
                },
                activity::Attribution::from(&Self::creation_principal(user)),
                InitiativeId::from_uuid(id),
            )
            .await?;
        Ok(project.id.as_uuid())
    }

    #[tracing::instrument(skip_all, fields(task_id = %id), err)]
    pub(crate) async fn create_tracker_task_impl(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        properties: &ImportedTaskProperties,
        shared: bool,
    ) -> anyhow::Result<String> {
        let created = self
            .create_imported_task(
                user,
                Some(id),
                name,
                ImportedContent::Markdown(markdown.to_string()),
                properties,
                None,
                shared,
            )
            .await;
        let task = crate::import_workspace::already_created(created, id)?;
        // A replay may have returned a document created just before a crash.
        // Apply enrichment and sharing again to repair that partial attempt.
        let (_, roster) = self.team_roster(user).await;
        self.apply_task_properties(user, &task, properties, &roster)
            .await;
        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &task,
                model_entity::EntityType::Document,
            )
            .await
            .map_err(|error| anyhow::anyhow!("no edit access to imported task: {error:?}"))?;
        self.document_service
            .set_team_share(receipt, shared)
            .await?;
        Ok(task)
    }

    #[tracing::instrument(skip_all, fields(task_id = %id), err)]
    pub(crate) async fn link_tracker_task_impl(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        relations: &TrackerTaskRelations,
    ) -> anyhow::Result<()> {
        let principal = Self::creation_principal(user);
        let id = id.to_string();
        for (key, target, kind) in [
            (
                SystemPropertyKey::Project,
                relations.project,
                EntityType::Initiative,
            ),
            (
                SystemPropertyKey::ParentTask,
                relations.parent,
                EntityType::Task,
            ),
        ] {
            if let Some(target) = target {
                self.task_properties
                    .set_entity_property(
                        &principal,
                        &id,
                        key.uuid(),
                        Some(SetPropertyValue::EntityReference {
                            reference: EntityReference::new(target.to_string(), kind),
                        }),
                    )
                    .await?;
            }
        }
        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &id,
                model_entity::EntityType::Document,
            )
            .await
            .map_err(|error| {
                anyhow::anyhow!("no edit access to imported task labels: {error:?}")
            })?;
        self.document_properties
            .apply(
                user,
                &receipt,
                &id,
                &ImportedDocumentProperties {
                    values: Vec::new(),
                    tags: relations.labels.clone(),
                },
            )
            .await;
        Ok(())
    }
}
