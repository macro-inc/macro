//! GraphQL writes to the property catalog: definitions, their selectable
//! options, and the viewer's tag sets. Each write makes the same properties
//! service call, with the same team receipt and managed-definition guard, as
//! its REST route.

use std::{collections::HashMap, marker::PhantomData};

use async_graphql::{
    Context, Enum, ErrorExtensions, ID, InputObject, Name, Object, OneofObject, Positioned,
    SimpleObject, Union,
    parser::types::{FragmentDefinition, Selection, SelectionSet},
};
use entity_access::domain::ports::EntityAccessService;
use graphql_common::{GraphqlCacheDeletion, GraphqlPropertyEntityType};
use models_properties::{
    api::requests::{
        AddNumberOptionRequest, AddPropertyOptionRequest, AddStringOptionRequest,
        CreatePropertyDefinitionRequest, CreatePropertyScope, PropertyDataType, SelectNumberOption,
        SelectStringOption, UpdatePropertyOptionRequest,
    },
    service::{property_definition::PropertyDefinition, property_option::PropertyOption},
};
use properties::{
    PropertiesErr, PropertiesService,
    domain::{
        model::{TagScope, TagSet},
        service::TeamReceipt,
    },
};
use uuid::Uuid;

use crate::{
    EntityPropertyReader, EntityPropertyWriter, GraphqlPropertyDataType, GraphqlPropertyDefinition,
    GraphqlPropertyOption, GraphqlTagScope, GraphqlTagSet, PropertiesEntityPropertyWriter,
    loaders::caller_team_receipt,
};

#[cfg(test)]
mod test;

/// GraphQL boundary for property catalog writes. Every method defaults to
/// refusing, so a writer that only assigns values need not implement it.
pub trait PropertyCatalogWriter: Send + Sync + 'static {
    /// Create a definition owned by the caller or their team, with any select
    /// options it was created with.
    fn create_property_definition(
        &self,
        _request: CreatePropertyDefinitionRequest,
    ) -> impl Future<Output = Result<PropertyDefinition, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Delete a definition owned by the caller or their team.
    fn delete_property_definition(
        &self,
        _property_definition_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Add a selectable option to a definition the caller owns, under the
    /// client's id when it sent one.
    fn add_property_option(
        &self,
        _property_definition_id: Uuid,
        _option_id: Option<Uuid>,
        _request: AddPropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Rename, recolor, or reorder one option in place.
    fn update_property_option(
        &self,
        _property_definition_id: Uuid,
        _option_id: Uuid,
        _request: UpdatePropertyOptionRequest,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Delete one option, stripping it from every value that holds it.
    fn delete_property_option(
        &self,
        _property_definition_id: Uuid,
        _option_id: Uuid,
    ) -> impl Future<Output = Result<(), PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Provision (get or create) the caller's tag set for a scope.
    fn ensure_tag_set(
        &self,
        _scope: TagScope,
    ) -> impl Future<Output = Result<TagSet, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Move one of the caller's personal labels into their team's tag set.
    fn promote_tag_option(
        &self,
        _option_id: Uuid,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }

    /// Replace a personal label with a team label, retagging what carried it.
    fn merge_tag_option(
        &self,
        _option_id: Uuid,
        _target_option_id: Uuid,
    ) -> impl Future<Output = Result<PropertyOption, PropertiesErr>> + Send {
        async { Err(not_configured()) }
    }
}

/// The refusal of a writer built without the properties service.
fn not_configured() -> PropertiesErr {
    PropertiesErr::Repo(rootcause::report!("property catalog writer is not configured").into())
}

impl<P, A> PropertiesEntityPropertyWriter<P, A>
where
    P: PropertiesService,
    A: EntityAccessService,
{
    /// The caller's team membership proof, as the REST team extractor mints it.
    async fn team(&self) -> Result<Option<TeamReceipt>, PropertiesErr> {
        caller_team_receipt(self.entity_access_service.as_ref(), &self.user_id)
            .await
            .map_err(|err| PropertiesErr::Repo(err.into()))
    }

    /// Refuse writes to a team definition another feature manages.
    async fn reject_managed(
        &self,
        property_definition_id: Uuid,
        team: Option<&TeamReceipt>,
    ) -> Result<(), PropertiesErr> {
        self.managed_team_definitions
            .reject_definition(
                self.properties_service.as_ref(),
                property_definition_id,
                &self.user_id,
                team,
            )
            .await
    }
}

impl<P, A> PropertyCatalogWriter for PropertiesEntityPropertyWriter<P, A>
where
    P: PropertiesService,
    A: EntityAccessService,
{
    async fn create_property_definition(
        &self,
        request: CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, PropertiesErr> {
        self.managed_team_definitions
            .reject_create(request.scope, &request.display_name)?;
        let team = self.team().await?;
        // The definition is committed when this returns. Its options load
        // only if the selection asks for them, so a failed read cannot turn a
        // committed create into a reported failure.
        self.properties_service
            .create_property_definition(&self.user_id, team.as_ref(), &request)
            .await
    }

    async fn delete_property_definition(
        &self,
        property_definition_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        let team = self.team().await?;
        self.reject_managed(property_definition_id, team.as_ref())
            .await?;
        self.properties_service
            .delete_property_definition(property_definition_id, &self.user_id, team.as_ref())
            .await
    }

    async fn add_property_option(
        &self,
        property_definition_id: Uuid,
        option_id: Option<Uuid>,
        request: AddPropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        let team = self.team().await?;
        self.reject_managed(property_definition_id, team.as_ref())
            .await?;
        match option_id {
            Some(option_id) => {
                self.properties_service
                    .add_property_option_with_id(
                        &self.user_id,
                        team.as_ref(),
                        property_definition_id,
                        option_id,
                        &request,
                    )
                    .await
            }
            None => {
                self.properties_service
                    .add_property_option(
                        &self.user_id,
                        team.as_ref(),
                        property_definition_id,
                        &request,
                    )
                    .await
            }
        }
    }

    async fn update_property_option(
        &self,
        property_definition_id: Uuid,
        option_id: Uuid,
        request: UpdatePropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        let team = self.team().await?;
        self.reject_managed(property_definition_id, team.as_ref())
            .await?;
        self.properties_service
            .update_property_option(
                &self.user_id,
                team.as_ref(),
                property_definition_id,
                option_id,
                &request,
            )
            .await
    }

    async fn delete_property_option(
        &self,
        property_definition_id: Uuid,
        option_id: Uuid,
    ) -> Result<(), PropertiesErr> {
        let team = self.team().await?;
        self.reject_managed(property_definition_id, team.as_ref())
            .await?;
        self.properties_service
            .delete_property_option(
                &self.user_id,
                team.as_ref(),
                property_definition_id,
                option_id,
            )
            .await
    }

    async fn ensure_tag_set(&self, scope: TagScope) -> Result<TagSet, PropertiesErr> {
        let team = self.team().await?;
        self.properties_service
            .ensure_tag_set(&self.user_id, team.as_ref(), scope)
            .await
    }

    async fn promote_tag_option(&self, option_id: Uuid) -> Result<PropertyOption, PropertiesErr> {
        let team = self.team().await?;
        self.properties_service
            .promote_tag_option(&self.user_id, team.as_ref(), option_id)
            .await
    }

    async fn merge_tag_option(
        &self,
        option_id: Uuid,
        target_option_id: Uuid,
    ) -> Result<PropertyOption, PropertiesErr> {
        let team = self.team().await?;
        self.properties_service
            .merge_tag_option(&self.user_id, team.as_ref(), option_id, target_option_id)
            .await
    }
}

/// Map a domain refusal to a GraphQL error whose `extensions.code` names its
/// REST status class, so a client can tell a rejected write from a fault.
fn catalog_error(err: PropertiesErr) -> async_graphql::Error {
    let code = match &err {
        PropertiesErr::Validation(_) => "BAD_REQUEST",
        PropertiesErr::NotFound
        | PropertiesErr::OptionNotFound
        | PropertiesErr::EntityPropertyNotFound => "NOT_FOUND",
        PropertiesErr::DuplicateOptionValue
        | PropertiesErr::ConflictingTeamLabel(_)
        | PropertiesErr::ReservedName(_) => "CONFLICT",
        PropertiesErr::PermissionDenied
        | PropertiesErr::SystemPropertyNotModifiable
        | PropertiesErr::RequiredProperty
        | PropertiesErr::TeamMembershipRequired
        | PropertiesErr::ManagedDefinition => "FORBIDDEN",
        PropertiesErr::Repo(_) | PropertiesErr::PermissionServiceNotConfigured => {
            tracing::error!(error = ?err, "property catalog write failed");
            return async_graphql::Error::new("property catalog write failed")
                .extend_with(|_, extensions| extensions.set("code", "INTERNAL"));
        }
    };
    async_graphql::Error::new(err.to_string())
        .extend_with(|_, extensions| extensions.set("code", code))
}

/// A malformed catalog write, refused before it reaches the domain.
fn bad_request(message: impl Into<String>) -> async_graphql::Error {
    async_graphql::Error::new(message.into())
        .extend_with(|_, extensions| extensions.set("code", "BAD_REQUEST"))
}

/// Parse a catalog id argument. The refusal names the argument, never the
/// value, which may be anything a client sent.
fn catalog_id(id: &ID, field: &str) -> async_graphql::Result<Uuid> {
    Uuid::parse_str(id.as_str()).map_err(|_| bad_request(format!("`{field}` is not a valid id")))
}

/// The id a deletion marker names: the form the deleted object's own `id`
/// field takes, so the client drops the record it holds.
fn canonical_id(id: Uuid) -> ID {
    ID(id.to_string())
}

/// Root fields that write the property catalog.
const CATALOG_WRITES: [&str; 8] = [
    "createPropertyDefinition",
    "deletePropertyDefinition",
    "addPropertyOption",
    "updatePropertyOption",
    "deletePropertyOption",
    "ensureTagSet",
    "promoteTag",
    "mergeTag",
];

/// Refuse an operation that names more than one catalog write, before any of
/// them runs. Deleting a definition or option, and sharing or replacing a
/// tag, rewrite every value that uses it, so one request runs at most one
/// such write, as one REST request does.
fn one_catalog_write(ctx: &Context<'_>) -> async_graphql::Result<()> {
    let env = ctx.query_env;
    let writes = count_catalog_writes(&env.operation.node.selection_set.node, &env.fragments, 0);
    // An operation nested too deep to count is refused rather than let through.
    if writes.is_none_or(|writes| writes > 1) {
        return Err(bad_request(
            "send each property catalog write in its own request",
        ));
    }
    Ok(())
}

/// Fragments nested deeper than this are not counted: the operation is refused.
const MAX_CATALOG_FRAGMENT_DEPTH: usize = 16;

/// Count catalog write fields at the root of an operation, through fragments.
/// `None` when fragments nest deeper than [`MAX_CATALOG_FRAGMENT_DEPTH`].
fn count_catalog_writes(
    selection_set: &SelectionSet,
    fragments: &HashMap<Name, Positioned<FragmentDefinition>>,
    depth: usize,
) -> Option<usize> {
    if depth > MAX_CATALOG_FRAGMENT_DEPTH {
        return None;
    }
    selection_set
        .items
        .iter()
        .map(|item| match &item.node {
            Selection::Field(field) => Some(usize::from(
                CATALOG_WRITES.contains(&field.node.name.node.as_str()),
            )),
            Selection::FragmentSpread(spread) => fragments
                .get(&spread.node.fragment_name.node)
                .map_or(Some(0), |fragment| {
                    count_catalog_writes(&fragment.node.selection_set.node, fragments, depth + 1)
                }),
            Selection::InlineFragment(inline) => {
                count_catalog_writes(&inline.node.selection_set.node, fragments, depth + 1)
            }
        })
        .sum()
}

/// Who owns a new property definition.
#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlCreatePropertyScope {
    /// The caller.
    User,
    /// The caller's team; requires team membership.
    Team,
}

/// A selectable option's value: text for string selects and tags, a number for
/// numeric selects.
#[derive(OneofObject)]
pub enum GraphqlPropertyOptionValueInput {
    /// Text of a string select option or tag.
    String(String),
    /// Number of a numeric select option.
    Number(f64),
}

/// An option a select definition is created with.
#[derive(InputObject)]
pub struct GraphqlPropertyOptionSeedInput {
    /// Ordering within the definition's options.
    display_order: i32,
    /// The option's value; its kind must match the definition's data type.
    value: GraphqlPropertyOptionValueInput,
}

/// Input for creating a property definition.
#[derive(InputObject)]
pub struct CreatePropertyDefinitionInput {
    /// Owner of the new definition.
    scope: GraphqlCreatePropertyScope,
    /// User-visible property name.
    display_name: String,
    /// Value type; tag sets are provisioned with `ensureTagSet` instead.
    data_type: GraphqlPropertyDataType,
    /// Whether more than one value may be selected (select, entity and link
    /// types only).
    #[graphql(default)]
    is_multi_select: bool,
    /// Entity-reference type constraint (entity type only).
    specific_entity_type: Option<GraphqlPropertyEntityType>,
    /// Options to create with a select definition.
    #[graphql(default)]
    options: Vec<GraphqlPropertyOptionSeedInput>,
}

impl CreatePropertyDefinitionInput {
    /// Convert into the request the REST route accepts.
    fn try_into_request(self) -> async_graphql::Result<CreatePropertyDefinitionRequest> {
        let multi = self.is_multi_select;
        let has_options = !self.options.is_empty();
        let refuse_options = |kind: &str| {
            if has_options {
                return Err(bad_request(format!("a {kind} property has no options")));
            }
            Ok(())
        };
        let refuse_entity_type = || {
            if self.specific_entity_type.is_some() {
                return Err(bad_request(
                    "only an entity property takes a specific entity type",
                ));
            }
            Ok(())
        };
        let refuse_multi = |kind: &str| {
            if multi {
                return Err(bad_request(format!("a {kind} property is single-valued")));
            }
            Ok(())
        };
        let data_type = match self.data_type {
            GraphqlPropertyDataType::Boolean
            | GraphqlPropertyDataType::Date
            | GraphqlPropertyDataType::DateRange
            | GraphqlPropertyDataType::Number
            | GraphqlPropertyDataType::String => {
                let (kind, data_type) = match self.data_type {
                    GraphqlPropertyDataType::Boolean => ("boolean", PropertyDataType::Boolean),
                    GraphqlPropertyDataType::Date => ("date", PropertyDataType::Date),
                    GraphqlPropertyDataType::DateRange => {
                        ("date range", PropertyDataType::DateRange)
                    }
                    GraphqlPropertyDataType::Number => ("number", PropertyDataType::Number),
                    _ => ("string", PropertyDataType::String),
                };
                refuse_options(kind)?;
                refuse_entity_type()?;
                refuse_multi(kind)?;
                data_type
            }
            GraphqlPropertyDataType::SelectString => {
                refuse_entity_type()?;
                PropertyDataType::SelectString {
                    options: self
                        .options
                        .into_iter()
                        .map(|seed| match seed.value {
                            GraphqlPropertyOptionValueInput::String(value) => {
                                Ok(SelectStringOption {
                                    display_order: seed.display_order,
                                    value,
                                })
                            }
                            GraphqlPropertyOptionValueInput::Number(_) => {
                                Err(bad_request("a string select property takes string options"))
                            }
                        })
                        .collect::<async_graphql::Result<_>>()?,
                    multi,
                }
            }
            GraphqlPropertyDataType::SelectNumber => {
                refuse_entity_type()?;
                PropertyDataType::SelectNumber {
                    options: self
                        .options
                        .into_iter()
                        .map(|seed| match seed.value {
                            GraphqlPropertyOptionValueInput::Number(value) => {
                                Ok(SelectNumberOption {
                                    display_order: seed.display_order,
                                    value,
                                })
                            }
                            GraphqlPropertyOptionValueInput::String(_) => {
                                Err(bad_request("a number select property takes number options"))
                            }
                        })
                        .collect::<async_graphql::Result<_>>()?,
                    multi,
                }
            }
            GraphqlPropertyDataType::Entity => {
                refuse_options("entity")?;
                PropertyDataType::Entity {
                    specific_type: self
                        .specific_entity_type
                        .map(GraphqlPropertyEntityType::into_model),
                    multi,
                }
            }
            GraphqlPropertyDataType::Link => {
                refuse_options("link")?;
                refuse_entity_type()?;
                PropertyDataType::Link { multi }
            }
            GraphqlPropertyDataType::Tag => {
                return Err(bad_request(
                    "tag sets are provisioned with ensureTagSet, not created",
                ));
            }
        };
        Ok(CreatePropertyDefinitionRequest {
            scope: match self.scope {
                GraphqlCreatePropertyScope::User => CreatePropertyScope::User,
                GraphqlCreatePropertyScope::Team => CreatePropertyScope::Team,
            },
            display_name: self.display_name,
            data_type,
        })
    }
}

/// Input for adding an option to a select definition or tag set.
#[derive(InputObject)]
pub struct AddPropertyOptionInput {
    /// Id for the new option, minted by the client. A retry with the same id
    /// answers with the option the first attempt created instead of adding
    /// another; an id another option holds is refused. The server mints one
    /// when it is absent.
    id: Option<ID>,
    /// Definition receiving the option.
    property_definition_id: ID,
    /// Ordering within the definition's options.
    display_order: i32,
    /// The option's value; its kind must match the definition's data type.
    value: GraphqlPropertyOptionValueInput,
    /// Display color as `#RRGGBB` (string options and tags only).
    color: Option<String>,
}

impl AddPropertyOptionInput {
    /// Convert into the definition id, the client's option id, and the
    /// request the REST route accepts.
    fn try_into_request(
        self,
    ) -> async_graphql::Result<(Uuid, Option<Uuid>, AddPropertyOptionRequest)> {
        let definition_id = catalog_id(&self.property_definition_id, "propertyDefinitionId")?;
        let option_id = self
            .id
            .as_ref()
            .map(|id| catalog_id(id, "id"))
            .transpose()?;
        let request = match self.value {
            GraphqlPropertyOptionValueInput::String(value) => {
                AddPropertyOptionRequest::SelectString {
                    option: AddStringOptionRequest {
                        display_order: self.display_order,
                        value,
                        color: self.color,
                    },
                }
            }
            GraphqlPropertyOptionValueInput::Number(value) => {
                if self.color.is_some() {
                    return Err(bad_request("a number option has no color"));
                }
                AddPropertyOptionRequest::SelectNumber {
                    option: AddNumberOptionRequest {
                        display_order: self.display_order,
                        value,
                    },
                }
            }
        };
        Ok((definition_id, option_id, request))
    }
}

/// Input for changing an option in place. Omitted fields keep their value.
#[derive(InputObject)]
pub struct UpdatePropertyOptionInput {
    /// Definition owning the option.
    property_definition_id: ID,
    /// Option to change.
    option_id: ID,
    /// New text (string options and tags only).
    value: Option<String>,
    /// New color as `#RRGGBB`.
    color: Option<String>,
    /// New position within the definition's options.
    display_order: Option<i32>,
}

/// A personal label now in the team's tag set, keeping its id.
#[derive(SimpleObject)]
pub struct GraphqlPromotedTag {
    /// The label, now owned by the team tag set.
    option: GraphqlPropertyOption,
}

/// The team already has a label with that name; nothing changed. Merging into
/// `conflictingOption` with `mergeTag` replaces the personal label instead.
#[derive(SimpleObject)]
pub struct GraphqlTagPromotionConflict {
    /// Why the label was not moved.
    message: String,
    /// The team label with the same name.
    conflicting_option: GraphqlPropertyOption,
}

/// Outcome of sharing a personal label with the team.
#[derive(Union)]
pub enum GraphqlTagPromotion {
    /// The label moved into the team tag set.
    Promoted(GraphqlPromotedTag),
    /// A team label already has the name.
    Conflict(GraphqlTagPromotionConflict),
}

/// A personal label replaced by a team label.
#[derive(SimpleObject)]
pub struct GraphqlTagMerge {
    /// The team label every entity now carries instead.
    option: GraphqlPropertyOption,
    /// The deleted personal label's cache record.
    removed_option: GraphqlCacheDeletion,
}

/// Mutation root for property catalog writes.
pub struct PropertyCatalogMutationRoot<W, R>(PhantomData<(W, R)>);

impl<W, R> Default for PropertyCatalogMutationRoot<W, R> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

impl<W, R> PropertyCatalogMutationRoot<W, R> {
    /// Create a mutation root for the configured writer and reader.
    pub fn new() -> Self {
        Self::default()
    }
}

/// Writes to property definitions, their options, and the viewer's tag sets.
/// An operation carries at most one of them.
#[Object]
impl<W, R> PropertyCatalogMutationRoot<W, R>
where
    W: EntityPropertyWriter,
    R: EntityPropertyReader,
{
    /// Create a property definition owned by the viewer or their team.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(property_definition_id = tracing::field::Empty)
    )]
    async fn create_property_definition(
        &self,
        ctx: &Context<'_>,
        input: CreatePropertyDefinitionInput,
    ) -> async_graphql::Result<GraphqlPropertyDefinition<R>> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let request = input.try_into_request()?;
        let created = writer
            .create_property_definition(request)
            .await
            .map_err(catalog_error)?;
        tracing::Span::current().record(
            "property_definition_id",
            tracing::field::display(created.id),
        );
        Ok(GraphqlPropertyDefinition::new(created))
    }

    /// Delete a property definition and identify its normalized cache record.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(property_definition_id = tracing::field::Empty)
    )]
    async fn delete_property_definition(
        &self,
        ctx: &Context<'_>,
        property_definition_id: ID,
    ) -> async_graphql::Result<GraphqlCacheDeletion> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let definition_id = catalog_id(&property_definition_id, "propertyDefinitionId")?;
        tracing::Span::current().record(
            "property_definition_id",
            tracing::field::display(definition_id),
        );
        writer
            .delete_property_definition(definition_id)
            .await
            .map_err(catalog_error)?;
        Ok(GraphqlCacheDeletion::new(
            "GraphqlPropertyDefinition",
            canonical_id(definition_id),
        ))
    }

    /// Add a selectable option to a definition or tag set. With a client id,
    /// a retried add answers with the option it created the first time.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(
            property_definition_id = tracing::field::Empty,
            option_id = tracing::field::Empty
        )
    )]
    async fn add_property_option(
        &self,
        ctx: &Context<'_>,
        input: AddPropertyOptionInput,
    ) -> async_graphql::Result<GraphqlPropertyOption> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let (definition_id, option_id, request) = input.try_into_request()?;
        let span = tracing::Span::current();
        span.record(
            "property_definition_id",
            tracing::field::display(definition_id),
        );
        let option = writer
            .add_property_option(definition_id, option_id, request)
            .await
            .map_err(catalog_error)?;
        span.record("option_id", tracing::field::display(option.id));
        Ok(option.into())
    }

    /// Rename, recolor, or reorder one option in place.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(
            property_definition_id = tracing::field::Empty,
            option_id = tracing::field::Empty
        )
    )]
    async fn update_property_option(
        &self,
        ctx: &Context<'_>,
        input: UpdatePropertyOptionInput,
    ) -> async_graphql::Result<GraphqlPropertyOption> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let definition_id = catalog_id(&input.property_definition_id, "propertyDefinitionId")?;
        let option_id = catalog_id(&input.option_id, "optionId")?;
        let span = tracing::Span::current();
        span.record(
            "property_definition_id",
            tracing::field::display(definition_id),
        );
        span.record("option_id", tracing::field::display(option_id));
        let option = writer
            .update_property_option(
                definition_id,
                option_id,
                UpdatePropertyOptionRequest {
                    value: input.value,
                    color: input.color,
                    display_order: input.display_order,
                },
            )
            .await
            .map_err(catalog_error)?;
        Ok(option.into())
    }

    /// Delete one option and identify its normalized cache record.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(
            property_definition_id = tracing::field::Empty,
            option_id = tracing::field::Empty
        )
    )]
    async fn delete_property_option(
        &self,
        ctx: &Context<'_>,
        property_definition_id: ID,
        option_id: ID,
    ) -> async_graphql::Result<GraphqlCacheDeletion> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let definition_id = catalog_id(&property_definition_id, "propertyDefinitionId")?;
        let option_uuid = catalog_id(&option_id, "optionId")?;
        let span = tracing::Span::current();
        span.record(
            "property_definition_id",
            tracing::field::display(definition_id),
        );
        span.record("option_id", tracing::field::display(option_uuid));
        writer
            .delete_property_option(definition_id, option_uuid)
            .await
            .map_err(catalog_error)?;
        Ok(GraphqlCacheDeletion::new(
            "GraphqlPropertyOption",
            canonical_id(option_uuid),
        ))
    }

    /// Provision the viewer's tag set for a scope and return it.
    #[tracing::instrument(skip_all, err(Debug), fields(scope = ?scope))]
    async fn ensure_tag_set(
        &self,
        ctx: &Context<'_>,
        scope: GraphqlTagScope,
    ) -> async_graphql::Result<GraphqlTagSet<R>> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let set = writer
            .ensure_tag_set(match scope {
                GraphqlTagScope::User => TagScope::User,
                GraphqlTagScope::Team => TagScope::Team,
            })
            .await
            .map_err(catalog_error)?;
        Ok(set.into())
    }

    /// Share one of the viewer's personal labels with their team. A label the
    /// team already has by name answers with the conflict, not an error.
    #[tracing::instrument(skip_all, err(Debug), fields(option_id = tracing::field::Empty))]
    async fn promote_tag(
        &self,
        ctx: &Context<'_>,
        option_id: ID,
    ) -> async_graphql::Result<GraphqlTagPromotion> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let option_uuid = catalog_id(&option_id, "optionId")?;
        tracing::Span::current().record("option_id", tracing::field::display(option_uuid));
        let err = match writer.promote_tag_option(option_uuid).await {
            Ok(option) => {
                return Ok(GraphqlTagPromotion::Promoted(GraphqlPromotedTag {
                    option: option.into(),
                }));
            }
            Err(err) => err,
        };
        let message = err.to_string();
        match err {
            PropertiesErr::ConflictingTeamLabel(conflicting) => {
                Ok(GraphqlTagPromotion::Conflict(GraphqlTagPromotionConflict {
                    message,
                    conflicting_option: (*conflicting).into(),
                }))
            }
            err => Err(catalog_error(err)),
        }
    }

    /// Replace one of the viewer's personal labels with a team label.
    #[tracing::instrument(
        skip_all,
        err(Debug),
        fields(
            option_id = tracing::field::Empty,
            target_option_id = tracing::field::Empty
        )
    )]
    async fn merge_tag(
        &self,
        ctx: &Context<'_>,
        option_id: ID,
        target_option_id: ID,
    ) -> async_graphql::Result<GraphqlTagMerge> {
        one_catalog_write(ctx)?;
        let writer = ctx.data::<W>()?;
        let option_uuid = catalog_id(&option_id, "optionId")?;
        let target_uuid = catalog_id(&target_option_id, "targetOptionId")?;
        let span = tracing::Span::current();
        span.record("option_id", tracing::field::display(option_uuid));
        span.record("target_option_id", tracing::field::display(target_uuid));
        let option = writer
            .merge_tag_option(option_uuid, target_uuid)
            .await
            .map_err(catalog_error)?;
        Ok(GraphqlTagMerge {
            option: option.into(),
            removed_option: GraphqlCacheDeletion::new(
                "GraphqlPropertyOption",
                canonical_id(option_uuid),
            ),
        })
    }
}
