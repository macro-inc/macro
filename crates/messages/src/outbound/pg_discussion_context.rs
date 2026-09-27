use crate::domain::{
    delivery::{DiscussionContext, DiscussionContextReader},
    models::MessageParent,
};
use sqlx::PgPool;
use uuid::Uuid;

/// Parent metadata and discussion audience facts from MacroDB.
#[derive(Clone)]
pub struct PgDiscussionContext(pub PgPool);

impl PgDiscussionContext {
    /// Add project identity and properties through their owning services.
    pub fn with_initiatives<I, P>(
        self,
        initiatives: I,
        properties: std::sync::Arc<P>,
    ) -> ParentDiscussionContext<I, P> {
        ParentDiscussionContext {
            documents: self,
            initiatives,
            properties,
        }
    }

    async fn participants(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<Vec<String>, rootcause::Report> {
        Ok(sqlx::query_scalar!(
            r#"SELECT DISTINCT sender_id FROM comms_messages
            WHERE parent_entity_type = $1 AND parent_entity_id = $2 AND (id = $3 OR thread_id = $3)
                AND imported_author IS NULL"#,
            parent.entity_type(),
            parent.entity_id(),
            root
        )
        .fetch_all(&self.0)
        .await?)
    }
}

/// Parent context composed with the initiative and properties domain services.
pub struct ParentDiscussionContext<I, P> {
    documents: PgDiscussionContext,
    initiatives: I,
    properties: std::sync::Arc<P>,
}

impl<I: Clone, P> Clone for ParentDiscussionContext<I, P> {
    fn clone(&self) -> Self {
        Self {
            documents: self.documents.clone(),
            initiatives: self.initiatives.clone(),
            properties: self.properties.clone(),
        }
    }
}

impl<
    I: initiative::domain::lookup::InitiativeReader,
    P: properties::domain::service::PropertiesService,
> DiscussionContextReader for ParentDiscussionContext<I, P>
{
    async fn sender_profile_picture(
        &self,
        actor: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        self.documents.sender_profile_picture(actor).await
    }

    async fn context(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<DiscussionContext, rootcause::Report> {
        let MessageParent::Initiative(id) = parent else {
            return self.documents.context(parent, root).await;
        };
        let basic = self
            .initiatives
            .read_basic(initiative::domain::models::InitiativeId::from_uuid(*id))
            .await?
            .ok_or_else(|| rootcause::report!("initiative no longer exists"))?;
        // This machine-only read selects notification candidates. Delivery separately
        // rechecks each candidate's current parent access before exposing any content.
        let access = properties::domain::model::ViewReceipt::dangerously_assert_internal_user(
            &id.to_string(),
            entity_access::domain::models::EntityType::Initiative,
        );
        let assignees = match self
            .properties
            .get_system_property_value(&access, system_properties::SystemPropertyKey::Assignees)
            .await?
        {
            Some(models_properties::service::property_value::PropertyValue::EntityRef(refs)) => {
                refs.into_iter()
                    .filter(|reference| {
                        reference.entity_type == models_properties::EntityType::User
                    })
                    .map(|reference| reference.entity_id)
                    .collect()
            }
            _ => vec![],
        };
        Ok(DiscussionContext {
            name: basic.name,
            owner: basic.owner_id.to_string(),
            file_type: None,
            is_task: false,
            participants: self.documents.participants(parent, root).await?,
            assignees,
            sender_profile_picture: None,
            link_share_access: None,
        })
    }
}

impl DiscussionContextReader for PgDiscussionContext {
    async fn sender_profile_picture(
        &self,
        actor: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        Ok(sqlx::query_scalar!(r#"SELECT i.profile_picture FROM macro_user_info i JOIN "User" u ON u.macro_user_id = i.macro_user_id WHERE u.id = $1"#, actor)
            .fetch_optional(&self.0).await?.flatten())
    }
    async fn context(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<DiscussionContext, rootcause::Report> {
        let mut context = match parent {
            MessageParent::Document(_) => {
                let row = sqlx::query!(r#"SELECT d.name, d.owner, d."fileType" AS file_type,
                    (SELECT sp."linkShareAccessLevel"::"AccessLevel" FROM "DocumentPermission" dp
                        JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
                        WHERE dp."documentId" = d.id AND sp."linkShare" IN ('PUBLIC', 'TEAM')) AS "link_share_access: entity_access::domain::models::AccessLevel",
                    EXISTS (SELECT 1 FROM document_sub_type s WHERE s.document_id = d.id AND s.sub_type = 'task') AS "is_task!"
                    FROM "Document" d WHERE d.id = $1 AND d."deletedAt" IS NULL"#, parent.entity_id())
                    .fetch_one(&self.0).await?;
                DiscussionContext {
                    name: row.name,
                    owner: row.owner,
                    file_type: row.file_type,
                    is_task: row.is_task,
                    participants: vec![],
                    assignees: vec![],
                    sender_profile_picture: None,
                    link_share_access: row.link_share_access,
                }
            }
            MessageParent::Channel(_) => {
                return Err(rootcause::report!("channel has no discussion context"));
            }
            MessageParent::Initiative(_) => {
                return Err(rootcause::report!(
                    "initiative context service is not configured"
                ));
            }
        };
        context.participants = self.participants(parent, root).await?;
        if context.is_task {
            context.assignees = sqlx::query_scalar!(r#"SELECT ref->>'entity_id' AS "user_id!"
                FROM entity_properties p CROSS JOIN LATERAL jsonb_array_elements(p.values->'value') ref
                WHERE p.entity_type = 'DOCUMENT' AND p.entity_id = $1 AND p.property_definition_id = $2
                    AND p.values->>'type' = 'EntityReference' AND ref->>'entity_type' = 'USER'"#,
                parent.entity_id(), system_properties::SystemPropertyKey::Assignees.uuid())
                .fetch_all(&self.0).await?;
        }
        Ok(context)
    }
}

impl crate::domain::delivery::DiscussionMentionSharing for PgDiscussionContext {
    async fn grant(
        &self,
        document: Uuid,
        users: Vec<String>,
        level: entity_access::domain::models::AccessLevel,
    ) -> Result<(), rootcause::Report> {
        sqlx::query!(r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
            SELECT $1::uuid, 'document', u.user_id, 'user', $3::"AccessLevel"
            FROM UNNEST($2::text[]) u(user_id)
            WHERE EXISTS (SELECT 1 FROM "DocumentPermission" dp JOIN "SharePermission" sp ON sp.id = dp."sharePermissionId"
                JOIN "Document" d ON d.id = dp."documentId"
                WHERE dp."documentId" = $1::uuid::text AND sp."linkShare" IN ('PUBLIC', 'TEAM')
                    AND sp."linkShareAccessLevel"::"AccessLevel" = $3 AND d."deletedAt" IS NULL)
            ON CONFLICT (entity_id, entity_type, source_id, source_type) WHERE granted_from_project_id IS NULL DO NOTHING"#,
            document, &users, level as _).execute(&self.0).await?;
        Ok(())
    }
}
