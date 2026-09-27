//! Resolve viewer-owned favorites before asking any domain for a page.
use super::*;
use ::favorites::domain::{models::FavoriteFilter, ports::FavoritesService};
use item_filters::ast::{
    agent_session::AgentSessionLiteral, calendar_event::CalendarEventLiteral, call::CallLiteral,
    chat::ChatLiteral, document::DocumentLiteral, project::ProjectLiteral,
};
use std::{future::Future, pin::Pin};

#[cfg(test)]
mod test;

pub(super) trait FavoriteReader: Send + Sync {
    fn read<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Entity<'static>>, SoupErr>> + Send + 'a>>;
}

pub(super) struct Reader<S>(pub Arc<S>);

impl<S: FavoritesService> FavoriteReader for Reader<S> {
    fn read<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<Vec<Entity<'static>>, SoupErr>> + Send + 'a>> {
        Box::pin(async move {
            let favorites = self
                .0
                .list_favorites(user, &FavoriteFilter::default())
                .await
                .map_err(anyhow::Error::from)?;
            Ok(favorites
                .into_iter()
                .map(|favorite| favorite.entity_type.with_entity_string(favorite.entity_id))
                .collect())
        })
    }
}

pub(super) fn ids(entities: &[Entity<'_>], kind: EntityType) -> Vec<Uuid> {
    entities
        .iter()
        .filter(|entity| entity.entity_type == kind)
        .filter_map(|entity| Uuid::parse_str(&entity.entity_id).ok())
        .collect()
}

fn constrain<T: Clone>(
    tree: &mut Option<Arc<Expr<T>>>,
    ids: Vec<Uuid>,
    literal: impl Fn(Uuid) -> T,
) {
    let ids = balanced_or_tree(ids.into_iter().map(|id| Expr::val(literal(id))).collect())
        .unwrap_or_else(|| Arc::new(Expr::val(literal(Uuid::nil()))));
    *tree = Some(with_id_tree(ids, tree.as_ref()));
}

pub(super) fn apply(mut ast: EntityFilterAst, entities: &[Entity<'_>]) -> EntityFilterAst {
    ast.favorites_only = None;
    constrain(
        &mut ast.document_filter,
        ids(entities, EntityType::Document),
        DocumentLiteral::Id,
    );
    constrain(
        &mut ast.project_filter,
        ids(entities, EntityType::Project),
        ProjectLiteral::ProjectIdSelf,
    );
    constrain(
        &mut ast.chat_filter,
        ids(entities, EntityType::Chat),
        ChatLiteral::ChatId,
    );
    constrain(
        &mut ast.email_filter.tree,
        ids(entities, EntityType::EmailThread),
        EmailLiteral::ThreadId,
    );
    constrain(
        &mut ast.channel_filter,
        ids(entities, EntityType::Channel),
        ChannelLiteral::ChannelId,
    );
    constrain(
        &mut ast.channel_thread_filter,
        ids(entities, EntityType::ChannelMessage),
        ChannelThreadLiteral::ThreadId,
    );
    constrain(
        &mut ast.call_filter,
        ids(entities, EntityType::Call),
        CallLiteral::CallId,
    );
    constrain(
        &mut ast.calendar_event_filter,
        ids(entities, EntityType::CalendarEvent),
        CalendarEventLiteral::Id,
    );
    constrain(
        &mut ast.foreign_entity_filter,
        ids(entities, EntityType::ForeignEntity),
        ForeignEntityLiteral::Id,
    );
    constrain(
        &mut ast.agent_session_filter,
        ids(entities, EntityType::AgentSession),
        AgentSessionLiteral::Id,
    );
    // CRM and reminders expose an ID-list service contract instead of arbitrary
    // AST evaluation. Intersect those lists separately, never OR them together.
    ast
}

pub(super) fn intersect(requested: &mut Vec<Uuid>, favorites: Vec<Uuid>) -> bool {
    if requested.is_empty() {
        *requested = favorites;
    } else {
        requested.retain(|id| favorites.contains(id));
    }
    !requested.is_empty()
}
