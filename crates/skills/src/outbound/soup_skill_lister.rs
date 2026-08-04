//! Outbound adapter implementing [`SkillLister`] via the soup service.

use std::sync::Arc;

use cowlike::CowLike;
use document_sub_type::DocumentSubType;
use email::domain::models::PreviewView;
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, call::CallLiteral, channel::ChannelLiteral, channel::ChannelThreadLiteral,
    chat::ChatLiteral, crm_company::CrmCompanyLiteral, document::DocumentLiteral,
    email::EmailLiteral, foreign_entity::ForeignEntityLiteral, project::ProjectLiteral,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{SimpleSortMethod, TypeEraseCursor};
use models_soup::item::SoupItem;
use soup::domain::{
    models::{SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use uuid::Uuid;

use crate::domain::model::{SkillError, SkillSummary};
use crate::domain::ports::SkillLister;

/// [`SkillLister`] implementation backed by the soup service, which enforces
/// per-user access control on results. Lists documents with the `skill` sub
/// type, most recently updated first.
pub struct SoupSkillLister<S> {
    soup: Arc<S>,
}

impl<S> SoupSkillLister<S> {
    /// Create a new lister from a soup service.
    pub fn new(soup: Arc<S>) -> Self {
        Self { soup }
    }
}

impl<S> Clone for SoupSkillLister<S> {
    fn clone(&self) -> Self {
        Self {
            soup: self.soup.clone(),
        }
    }
}

/// Filter AST matching only documents with the `skill` sub type: every other
/// entity type is force-filtered to the nil id so soup skips it entirely.
fn skill_only_filter() -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            DocumentSubType::Skill,
        )))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectId(Uuid::nil())))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
        email_filter: item_filters::ast::EmailFilterAst {
            tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(Uuid::nil())))),
            crm_scope: None,
        },
        channel_filter: Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(Uuid::nil())))),
        channel_thread_filter: Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(
            Uuid::nil(),
        )))),
        call_filter: Some(Arc::new(Expr::val(CallLiteral::CallId(Uuid::nil())))),
        crm_company_filter: Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(Uuid::nil())))),
        foreign_entity_filter: Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(Uuid::nil())))),
        properties_filter: None,
    }
}

impl<S: SoupService> SkillLister for SoupSkillLister<S> {
    #[tracing::instrument(skip(self), err)]
    async fn list_skills(
        &self,
        user_id: &MacroUserIdStr<'_>,
        limit: u16,
    ) -> Result<Vec<SkillSummary>, SkillError> {
        let result = self
            .soup
            .get_user_soup(
                SoupRequest {
                    // Expanded includes documents reachable via project access, and
                    // is the only soup type that supports AST item filters (the
                    // unexpanded repo path rejects them as not implemented).
                    soup_type: SoupType::Expanded,
                    limit,
                    cursor: SoupQuery::new_sort_simple(
                        SimpleSortMethod::UpdatedAt,
                        skill_only_filter(),
                    ),
                    user: user_id.copied().into_owned(),
                    // Emails are force-filtered out above, so the preview view
                    // and inbox links never come into play.
                    email_preview_view: PreviewView::default(),
                    link_ids: Vec::new(),
                },
                None,
            )
            .await
            .map_err(|e| SkillError::ListFailed(e.into()))?;

        Ok(result
            .type_erase()
            .items
            .into_iter()
            .filter_map(|item| match item {
                SoupItem::Document(doc) => Some(SkillSummary {
                    document_id: doc.id,
                    name: doc.name,
                    updated_at: Some(doc.updated_at),
                }),
                _ => None,
            })
            .collect())
    }
}
