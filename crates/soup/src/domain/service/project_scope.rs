//! Let a project's viewers list its tasks. A project contains its tasks, so
//! a request that only asks for one project's tasks lists all of them when
//! the viewer can view that project, without a grant on each task.
use super::*;
use entity_access::domain::{
    models::{AccessError, EntityPermission},
    ports::EntityAccessService,
};
use item_filters::ast::properties::{PropertiesLiteral, PropertyEntityType, PropertyMatchValue};
use std::{future::Future, pin::Pin};
use system_properties::SystemPropertyKey;
use tracing::Instrument;

#[cfg(test)]
mod test;

pub(super) trait ProjectViewer: Send + Sync {
    fn can_view<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        project: Uuid,
    ) -> Pin<Box<dyn Future<Output = Result<bool, SoupErr>> + Send + 'a>>;
}

pub(super) struct Reader<S>(pub Arc<S>);

impl<S: EntityAccessService> ProjectViewer for Reader<S> {
    fn can_view<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        project: Uuid,
    ) -> Pin<Box<dyn Future<Output = Result<bool, SoupErr>> + Send + 'a>> {
        let span = tracing::info_span!(
            "soup.project_scope",
            project_id = %project,
            viewable = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let viewable = match self
                    .0
                    .get_entity_permission(
                        Some(user),
                        &project.to_string(),
                        EntityType::Initiative,
                        None,
                    )
                    .await
                {
                    Ok(EntityPermission::AccessLevel { .. }) => true,
                    Ok(_)
                    | Err(
                        AccessError::Unauthorized
                        | AccessError::UnauthorizedWithMessage(_)
                        | AccessError::NotFound(_),
                    ) => false,
                    Err(error) => {
                        return Err(anyhow::anyhow!(
                            "project {project} access check failed: {error}"
                        )
                        .into());
                    }
                };
                tracing::Span::current().record("viewable", viewable);
                Ok(viewable)
            }
            .instrument(span),
        )
    }
}

/// The one project every match of `ast` must belong to: a Project reference
/// that the property filter requires, not one it offers as an alternative.
/// Absent when the filter names no project, several, or only under an OR or
/// NOT.
pub(super) fn required_project(ast: &EntityFilterAst) -> Option<Uuid> {
    fn collect(expr: &Expr<PropertiesLiteral>, projects: &mut Vec<Uuid>) {
        match expr {
            Expr::And(left, right) => {
                collect(left, projects);
                collect(right, projects);
            }
            Expr::Literal(PropertiesLiteral {
                property_definition_id,
                entity_type: None | Some(PropertyEntityType::Task),
                value: PropertyMatchValue::EntityRef(id),
            }) if *property_definition_id == SystemPropertyKey::PROJECT_UUID => {
                if let Ok(project) = id.to_string().parse() {
                    projects.push(project);
                }
            }
            Expr::Or(..) | Expr::Not(_) | Expr::Literal(_) => {}
        }
    }
    let mut projects = Vec::new();
    collect(ast.properties_filter.as_deref()?, &mut projects);
    let first = *projects.first()?;
    projects
        .iter()
        .all(|project| *project == first)
        .then_some(first)
}

pub(super) fn apply(mut ast: EntityFilterAst, project: Uuid) -> EntityFilterAst {
    ast.viewable_project = Some(project);
    ast
}
