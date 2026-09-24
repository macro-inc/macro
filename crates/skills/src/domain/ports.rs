//! Ports for skill functionality.

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{
    SkillContent, SkillDocumentMetadata, SkillError, SkillMatchType, SkillSummary,
};

/// Outbound port: searches the skill documents visible to a user by name.
///
/// Implementations are responsible for enforcing per-user access control:
/// only skills the user can view may be returned.
pub trait SkillSearcher: Send + Sync + 'static {
    /// Search skills visible to `user_id` whose name matches `query`.
    fn search_skills_by_name(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: &str,
        match_type: SkillMatchType,
    ) -> impl Future<Output = Result<Vec<SkillSummary>, SkillError>> + Send;
}

/// Outbound port: lists the skill documents visible to a user.
///
/// Implementations are responsible for enforcing per-user access control:
/// only skills the user can view may be returned.
pub trait SkillLister: Send + Sync + 'static {
    /// List up to `limit` skills visible to `user_id`, most recently updated
    /// first.
    fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<SkillSummary>, SkillError>> + Send;
}

/// Inbound port: skill use cases exposed to inbound adapters.
pub trait SkillService: Send + Sync + 'static {
    /// Read complete instructions from a visible skill document or a built-in skill.
    fn read_skill(
        &self,
        user_id: &MacroUserIdStr<'_>,
        document_id: uuid::Uuid,
    ) -> impl Future<Output = Result<SkillContent, SkillError>> + Send;

    /// Search the skills visible to `user_id` whose name matches `query`,
    /// most recently updated first.
    fn search_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: &str,
        match_type: SkillMatchType,
    ) -> impl Future<Output = Result<Vec<SkillSummary>, SkillError>> + Send;

    /// List the skills visible to `user_id`, most recently updated first.
    fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<SkillSummary>, SkillError>> + Send;
}

/// Capabilities for accessing skill documents and their current markdown.
pub trait SkillReader: Send + Sync + 'static {
    /// Obtain proof that the caller can view the document through entity access.
    fn authorize(
        &self,
        user_id: &MacroUserIdStr<'_>,
        document_id: uuid::Uuid,
    ) -> impl Future<Output = Result<EntityAccessReceipt<ViewAccessLevel>, SkillError>> + Send;

    /// Read document facts only after access has been established.
    fn metadata(
        &self,
        receipt: &EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<SkillDocumentMetadata, SkillError>> + Send;

    /// Read the complete current markdown of an authorized document.
    fn markdown(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<String, SkillError>> + Send;
}
