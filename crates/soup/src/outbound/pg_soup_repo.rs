use crate::{
    domain::{
        models::{
            AdvancedSortParams, GroupedSortRequest, SimpleSortQuery, SimpleSortRequest,
            SoupPropertiesField, grouping::ItemGroupingInfo,
        },
        ports::SoupRepo,
    },
    outbound::pg_soup_repo::expanded::dynamic::{
        ExpandedDynamicCursorArgs, GroupedDynamicCursorArgs,
    },
};
use either::Either;
use macro_user_id::user_id::MacroUserIdStr;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::{SoupProperty, item::SoupItem};
use readonly_pool::ReadOnlyPool;
use system_properties::SystemPropertyKey;

mod expanded;
pub mod grouping;
mod unexpanded;

/// PostgreSQL implementation of [`SoupRepo`].
pub struct PgSoupRepo {
    pool: ReadOnlyPool,
}

impl PgSoupRepo {
    /// Creates a PostgreSQL soup repository using the provided read-only pool.
    pub fn new(pool: ReadOnlyPool) -> Self {
        PgSoupRepo { pool }
    }
}

impl SoupRepo for PgSoupRepo {
    type Err = sqlx::Error;
    type GroupedItems = std::vec::IntoIter<ItemGroupingInfo>;

    fn expanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send {
        match req.cursor {
            SimpleSortQuery::ItemsAndFrecencyFilter(query) => {
                // Extract the EntityFilterAst from the tuple (Frecency, EntityFilterAst)
                Either::Left(Either::Left(
                    expanded::dynamic::expanded_dynamic_cursor_soup(
                        &self.pool.0,
                        ExpandedDynamicCursorArgs {
                            user_id: req.user_id,
                            limit: req.limit,
                            cursor: query.map_filter(|(_, ast)| ast),
                            exclude_frecency: true,
                        },
                    ),
                ))
            }
            SimpleSortQuery::ItemsFilter(ast) => Either::Left(Either::Right(
                expanded::dynamic::expanded_dynamic_cursor_soup(
                    &self.pool.0,
                    ExpandedDynamicCursorArgs {
                        user_id: req.user_id,
                        limit: req.limit,
                        cursor: ast,
                        exclude_frecency: false,
                    },
                ),
            )),
            SimpleSortQuery::FilterFrecency(f) => Either::Right(Either::Left(
                expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.pool.0,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
            SimpleSortQuery::NoFilter(f) => Either::Right(Either::Right(
                expanded::by_cursor::expanded_generic_cursor_soup(
                    &self.pool.0,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
        }
    }

    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send {
        match req.cursor {
            SimpleSortQuery::ItemsFilter(_) => Either::Left(Either::Left(not_implemented(req))),
            SimpleSortQuery::ItemsAndFrecencyFilter(_) => {
                Either::Left(Either::Right(not_implemented(req)))
            }
            SimpleSortQuery::FilterFrecency(f) => Either::Right(Either::Left(
                expanded::by_cursor::no_frecency_expanded_generic_soup(
                    &self.pool.0,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
            SimpleSortQuery::NoFilter(f) => Either::Right(Either::Right(
                unexpanded::by_cursor::unexpanded_generic_cursor_soup(
                    &self.pool.0,
                    req.user_id,
                    req.limit,
                    f,
                ),
            )),
        }
    }

    fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send {
        expanded::by_ids::expanded_soup_by_ids(&self.pool.0, req.user_id, req.entities)
    }

    fn unexpanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send {
        unexpanded::by_ids::unexpanded_soup_by_ids(&self.pool.0, req.user_id, req.entities)
    }

    fn populate_properties<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
        items: Vec<SoupItem<()>>,
    ) -> impl Future<Output = Result<Vec<SoupItem<SoupPropertiesField>>, Self::Err>> + Send {
        populate_properties(&self.pool.0, user_id, items)
    }

    async fn caller_tag_sets<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, Self::Err> {
        properties::outbound::property_definition_queries::get_caller_tag_definitions_with_options(
            &self.pool.0,
            user_id.as_ref(),
        )
        .await
        .map_err(|e| sqlx::Error::Decode(e.into()))
    }

    async fn expanded_grouped_cursor_soup<'a>(
        &self,
        req: GroupedSortRequest<'a>,
    ) -> Result<Self::GroupedItems, Self::Err> {
        expanded::dynamic::expanded_dynamic_cursor_soup_grouped(
            &self.pool.0,
            GroupedDynamicCursorArgs {
                user_id: req.user_id,
                limit: req.limit,
                cursor: req.cursor,
                exclude_frecency: false,
                grouping: req.grouping,
            },
        )
        .await
    }
}

#[tracing::instrument(err)]
async fn not_implemented<Ok>(_req: SimpleSortRequest<'_>) -> Result<Ok, sqlx::Error> {
    Err(sqlx::Error::InvalidArgument(
        "Unexpanded soup ast filters are not yet supported".to_string(),
    ))
}

/// utility fn for queries to create a sqlx err
fn type_err<E: std::fmt::Display>(e: E) -> sqlx::Error {
    sqlx::Error::TypeNotFound {
        type_name: e.to_string(),
    }
}

/// Fetches properties and attaches them to raw Soup items.
///
/// This helper collects entity references from items that support properties
/// and performs one bulk lookup. System properties are always included, plus
/// the caller's own and team tag properties. Tasks use `EntityType::Task` while
/// regular documents use `EntityType::Document`.
#[tracing::instrument(err, skip(db, items))]
pub(crate) async fn populate_properties(
    db: &sqlx::PgPool,
    user_id: MacroUserIdStr<'_>,
    items: Vec<SoupItem<()>>,
) -> Result<Vec<SoupItem<SoupPropertiesField>>, sqlx::Error> {
    let entity_refs = items
        .iter()
        .filter_map(SoupItem::to_entity_reference)
        .collect::<Vec<_>>();

    if entity_refs.is_empty() {
        return Ok(items
            .into_iter()
            .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
            .collect());
    }

    let property_ids = SystemPropertyKey::all_system_property_keys();
    let properties_map =
        properties::outbound::entity_properties_get_query::get_bulk_entity_properties_values_filtered(
            db,
            &entity_refs,
            property_ids,
            Some(&user_id),
        )
        .await
        .map_err(|e| sqlx::Error::Decode(e.into()))?;

    // Items may repeat an id when grouped, so use `get` rather than `remove`.
    Ok(items
        .into_iter()
        .map(|item| {
            let properties = match &item {
                SoupItem::Document(x) => properties_map.get(&x.id.to_string()),
                SoupItem::Project(x) => properties_map.get(&x.id.to_string()),
                SoupItem::EmailThread(x) => properties_map.get(&x.thread.id.to_string()),
                SoupItem::Chat(x) => properties_map.get(&x.id.to_string()),
                SoupItem::CrmCompany(x) => properties_map.get(&x.id.to_string()),
                SoupItem::Call(x) => properties_map.get(&x.call_id.to_string()),
                SoupItem::Channel(_) | SoupItem::ChannelThread(_) | SoupItem::ForeignEntity(_) => {
                    None
                }
            }
            .map(|properties| properties.iter().cloned().map(SoupProperty::from).collect())
            .unwrap_or_default();

            item.map_extra(|()| SoupPropertiesField::new(properties))
        })
        .collect())
}

/// this defines a macro which maps the soup query types for statically checked soup queries
/// This must be a macro because compile time queries cannot have a named type so we can't use a function
#[macro_export]
macro_rules! map_soup_type {
    () => {
        |r| match r.item_type.as_ref() {
            "document" => Ok(::models_soup::item::SoupItem::Document(
                ::models_soup::document::SoupDocument {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    document_version_id: r
                        .document_version_id
                        .ok_or_else(|| type_err("document version id must exist"))
                        .and_then(|s| FromStr::from_str(&s).map_err(type_err))?,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    name: r.name,
                    file_type: r.file_type,
                    sha: r.sha,
                    project_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    branched_from_id: r
                        .branched_from_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    branched_from_version_id: r.branched_from_version_id,
                    document_family_id: r.document_family_id,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                    sub_type: ::models_soup::document::SoupDocumentSubType::from_db(
                        r.sub_type,
                        r.is_completed,
                    ),
                    deleted_at: r.deleted_at,
                    extra: (),
                },
            )),
            "chat" => Ok(::models_soup::item::SoupItem::Chat(
                ::models_soup::chat::SoupChat {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    name: r.name,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    project_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    is_persistent: r.is_persistent.unwrap_or_default(),
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                    deleted_at: r.deleted_at,
                    extra: (),
                },
            )),
            "project" => Ok(::models_soup::item::SoupItem::Project(
                ::models_soup::project::SoupProject {
                    id: Uuid::parse_str(&r.id).map_err(type_err)?,
                    name: r.name,
                    owner_id: MacroUserIdStr::parse_from_str(&r.user_id)
                        .map_err(type_err)?
                        .into_owned(),
                    parent_id: r
                        .project_id
                        .as_deref()
                        .map(Uuid::parse_str)
                        .transpose()
                        .map_err(type_err)?,
                    created_at: r.created_at,
                    updated_at: r.updated_at,
                    viewed_at: r.viewed_at,
                    deleted_at: r.deleted_at,
                    extra: (),
                },
            )),
            _ => Err(sqlx::Error::TypeNotFound {
                type_name: r.item_type,
            }),
        }
    };
}
