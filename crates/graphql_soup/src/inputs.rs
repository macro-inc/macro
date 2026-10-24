use async_graphql::{Enum, ID};
use graphql_common::{GraphqlPropertyEntityType, parse_id};
use graphql_soup_filter_input::GraphqlEntityFilterAst;
use item_filters::ast::{EntityFilterAst, properties::PropertyEntityType};
use macro_user_id::user_id::MacroUserIdStr;
use models_grouping::{DeadlineBoundaries, GroupByField, GroupingConfig};
use models_pagination::{
    Base64Str, CursorWithValAndFilter, DueDateSort, NotifiedAt, SimpleSortMethod,
};
use soup::domain::models::{
    GroupedSortMethod, GroupedSortQuery, SoupQuery, SoupRequest, SoupSortDirection, SoupType,
};
use uuid::Uuid;

/// Input for `Query.soup`.
#[derive(async_graphql::OneofObject)]
pub enum SoupInput {
    /// Start a new Soup query.
    Initial(Box<SoupInitialInput>),
    /// Continue a Soup query from an opaque cursor.
    Continuation(SoupContinuationInput),
}

/// Input for starting a Soup query.
#[derive(async_graphql::InputObject)]
pub struct SoupInitialInput {
    /// Maximum number of items to return. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Timestamp or task due-date sort. Defaults to VIEWED_AT.
    /// Frecency is not supported by this GraphQL adapter.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// Email preview view used when hydrating email Soup items.
    email_view: Option<GraphqlEmailView>,
    /// AST-shaped filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilterAst>,
    /// Direction to order the page in. Defaults to DESC.
    sort_direction: Option<GraphqlSortDirection>,
}

/// Input for continuing a Soup query.
#[derive(async_graphql::InputObject)]
pub struct SoupContinuationInput {
    /// Opaque cursor returned by a previous GraphQL Soup response.
    cursor: String,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Email preview view used when hydrating email Soup items.
    email_view: Option<GraphqlEmailView>,
    /// Direction to order the page in. Defaults to DESC.
    ///
    /// The cursor does not carry it, so re-send whatever the initial query
    /// used or the continuation flips order mid-list.
    sort_direction: Option<GraphqlSortDirection>,
}

/// Direction a Soup page is ordered in.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSortDirection {
    /// Oldest, or soonest-firing, first.
    Asc,
    /// Newest first.
    Desc,
}

impl GraphqlSortDirection {
    /// Convert this value into the domain representation.
    fn into_model(self) -> SoupSortDirection {
        match self {
            GraphqlSortDirection::Asc => SoupSortDirection::Asc,
            GraphqlSortDirection::Desc => SoupSortDirection::Desc,
        }
    }
}

/// Input for `Query.groupSoup`.
#[derive(async_graphql::OneofObject)]
pub enum GroupedSoupInput {
    /// Start a new grouped Soup query.
    Initial(Box<GroupedSoupInitialInput>),
    /// Continue one bin from a cursor returned by a previous grouped query.
    Continuation(GroupedSoupContinuationInput),
}

/// Input for starting a grouped Soup query.
#[derive(async_graphql::InputObject)]
pub struct GroupedSoupInitialInput {
    /// The field used to divide Soup items into bins.
    group_by: GraphqlGroupByInput,
    /// Maximum number of items to return per bin. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Sort order within each bin. Defaults to `VIEWED_UPDATED`.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// AST-shaped filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilterAst>,
}

/// Input for continuing a single grouped Soup bin.
#[derive(async_graphql::InputObject)]
pub struct GroupedSoupContinuationInput {
    /// The field used to divide Soup items into bins.
    group_by: GraphqlGroupByInput,
    /// The grouping key of the bin to continue.
    group_key: String,
    /// Opaque cursor returned for the bin by a previous grouped query.
    cursor: String,
}

impl GroupedSoupInput {
    /// Convert this value into the grouped Soup domain request.
    pub(crate) fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortQuery<'static>> {
        match self {
            Self::Initial(input) => input.into_request(macro_user_id),
            Self::Continuation(input) => input.into_request(macro_user_id),
        }
    }
}

impl GroupedSoupInitialInput {
    /// Convert an initial input into the grouped Soup domain request.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortQuery<'static>> {
        let filters = self
            .filters
            .map(GraphqlEntityFilterAst::into_ast)
            .transpose()?
            .unwrap_or_default();
        let sort_method = self
            .sort_method
            .unwrap_or(GraphqlSimpleSortMethod::ViewedUpdated)
            .into_model()?;
        let limit = self.limit.unwrap_or(20).clamp(1, 500);
        Ok(GroupedSortQuery::initial(
            macro_user_id,
            limit,
            sort_method,
            filters,
            GroupingConfig {
                field: self.group_by.into_group_by_field()?,
                group_key: None,
                per_group_limit: Some(u32::from(limit)),
            },
        )?)
    }
}

impl GroupedSoupContinuationInput {
    /// Decode a bin cursor into the grouped Soup domain request.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortQuery<'static>> {
        Ok(GroupedSortQuery::continue_from(
            macro_user_id,
            self.cursor,
            GroupingConfig {
                field: self.group_by.into_group_by_field()?,
                group_key: Some(self.group_key),
                per_group_limit: None,
            },
        )?)
    }
}

/// GraphQL representation of a field used to group Soup items.
#[derive(async_graphql::InputObject)]
struct GraphqlGroupByInput {
    /// The kind of grouping to perform.
    field: GraphqlGroupByField,
    /// Property definition to group by when `field` is `PROPERTY`.
    property_definition_id: Option<ID>,
    /// Optional property entity type restriction.
    entity_type: Option<GraphqlPropertyEntityType>,
    /// Frozen viewer-local UTC boundaries required when `field` is `DEADLINE`.
    deadline_boundaries: Option<GraphqlDeadlineBoundaries>,
}

/// Frozen starts of the viewer's local calendar days, expressed in UTC.
#[derive(async_graphql::InputObject, Clone)]
struct GraphqlDeadlineBoundaries {
    /// UTC start of the viewer's current local day.
    today: String,
    /// UTC start of the viewer's next local day.
    tomorrow: String,
    /// UTC start of the viewer's local day two days ahead.
    day_two: String,
    /// UTC start of the viewer's local day eight days ahead.
    day_eight: String,
}

impl TryFrom<&GraphqlDeadlineBoundaries> for DeadlineBoundaries {
    type Error = async_graphql::Error;

    fn try_from(value: &GraphqlDeadlineBoundaries) -> Result<Self, Self::Error> {
        Ok(Self {
            today: value.today.parse().map_err(|error| {
                async_graphql::Error::new(format!("invalid deadlineBoundaries.today: {error}"))
            })?,
            tomorrow: value.tomorrow.parse().map_err(|error| {
                async_graphql::Error::new(format!("invalid deadlineBoundaries.tomorrow: {error}"))
            })?,
            day_two: value.day_two.parse().map_err(|error| {
                async_graphql::Error::new(format!("invalid deadlineBoundaries.dayTwo: {error}"))
            })?,
            day_eight: value.day_eight.parse().map_err(|error| {
                async_graphql::Error::new(format!("invalid deadlineBoundaries.dayEight: {error}"))
            })?,
        })
    }
}

impl GraphqlGroupByInput {
    /// Convert this input into the grouping domain model.
    fn into_group_by_field(self) -> async_graphql::Result<GroupByField> {
        if self.deadline_boundaries.is_some() && self.field != GraphqlGroupByField::Deadline {
            return Err(async_graphql::Error::new(
                "deadlineBoundaries requires DEADLINE grouping",
            ));
        }
        match self.field {
            GraphqlGroupByField::Date => self.without_property_options(GroupByField::Date),
            GraphqlGroupByField::Deadline => {
                let boundaries = self
                    .deadline_boundaries
                    .as_ref()
                    .ok_or_else(|| {
                        async_graphql::Error::new(
                            "deadlineBoundaries is required when grouping by DEADLINE",
                        )
                    })?
                    .try_into()?;
                self.without_property_options(GroupByField::Deadline { boundaries })
            }
            GraphqlGroupByField::EntityType => {
                self.without_property_options(GroupByField::EntityType)
            }
            GraphqlGroupByField::Project => self.without_property_options(GroupByField::Project),
            GraphqlGroupByField::Property => {
                let property_definition_id = self.property_definition_id.ok_or_else(|| {
                    async_graphql::Error::new(
                        "propertyDefinitionId is required when grouping by PROPERTY",
                    )
                })?;
                let property_definition_id =
                    parse_id(property_definition_id, "propertyDefinitionId")?;
                let entity_type = self
                    .entity_type
                    .map(PropertyEntityType::try_from)
                    .transpose()
                    .map_err(|_| {
                        async_graphql::Error::new(
                            "CALL_RECORD is not supported for property grouping",
                        )
                    })?
                    .map(|entity_type| entity_type.to_string());

                Ok(GroupByField::Property {
                    property_definition_id,
                    entity_type,
                    bucketing: None,
                })
            }
        }
    }

    /// Reject property-only options for non-property grouping modes.
    fn without_property_options(
        self,
        group_by: GroupByField,
    ) -> async_graphql::Result<GroupByField> {
        if self.property_definition_id.is_some() || self.entity_type.is_some() {
            return Err(async_graphql::Error::new(
                "propertyDefinitionId and entityType require PROPERTY grouping",
            ));
        }
        Ok(group_by)
    }
}

/// Grouping modes supported by grouped Soup.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlGroupByField {
    /// Group into date buckets.
    Date,
    /// Group task deadlines using frozen viewer-local calendar boundaries.
    Deadline,
    /// Group by Soup entity type.
    EntityType,
    /// Group by containing project.
    Project,
    /// Group by a property value.
    Property,
}

impl SoupInput {
    /// Convert this value into the request representation.
    pub(crate) fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        match self {
            Self::Initial(input) => input.into_request(macro_user_id, link_ids),
            Self::Continuation(input) => input.into_request(macro_user_id, link_ids),
        }
    }
}

impl SoupInitialInput {
    /// Convert an initial input into the request representation.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let filter = self
            .filters
            .map(GraphqlEntityFilterAst::into_ast)
            .transpose()?
            .unwrap_or_default();
        let cursor = self
            .sort_method
            .unwrap_or(GraphqlSimpleSortMethod::ViewedAt)
            .into_query(filter)?;

        Ok(SoupRequest {
            soup_type: soup_type(self.expand),
            limit: self.limit.unwrap_or(20).min(500),
            sort_direction: sort_direction(&cursor, self.sort_direction)?,
            cursor,
            user: macro_user_id,
            email_preview_view: email_preview_view(self.email_view)?,
            link_ids,
        })
    }
}

impl SoupContinuationInput {
    /// Decode a cursor continuation into the request representation.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let cursor = Base64Str::<SoupContinuationCursor>::new_from_string(self.cursor)
            .decode_json()
            .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
        let (limit, cursor) = match cursor {
            SoupContinuationCursor::Simple(cursor) => {
                (cursor.limit, SoupQuery::new_cursor_simple(cursor))
            }
            SoupContinuationCursor::DueDate(cursor) => {
                (cursor.limit, SoupQuery::new_cursor_due_date(cursor))
            }
            SoupContinuationCursor::Notified(cursor) => {
                (cursor.limit, SoupQuery::new_cursor_notified(cursor))
            }
        };
        let limit = u16::try_from(limit).unwrap_or(500).min(500);

        Ok(SoupRequest {
            soup_type: soup_type(self.expand),
            limit,
            sort_direction: sort_direction(&cursor, self.sort_direction)?,
            cursor,
            user: macro_user_id,
            email_preview_view: email_preview_view(self.email_view)?,
            link_ids,
        })
    }
}

/// Distinguishes timestamp cursors from nullable due-date cursors.
#[derive(serde::Deserialize)]
#[serde(untagged)]
enum SoupContinuationCursor {
    /// An existing timestamp-sorted continuation.
    Simple(CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>),
    /// A task due-date continuation, including an undated last item.
    DueDate(CursorWithValAndFilter<Uuid, DueDateSort, EntityFilterAst>),
    /// A notification continuation, including channel-thread string identifiers.
    Notified(CursorWithValAndFilter<String, NotifiedAt, EntityFilterAst>),
}

/// Convert the optional GraphQL sort direction into the domain representation.
/// Notified pages are keyset-ordered newest first, so ascending is rejected
/// rather than silently ignored.
fn sort_direction(
    cursor: &SoupQuery<EntityFilterAst>,
    direction: Option<GraphqlSortDirection>,
) -> async_graphql::Result<SoupSortDirection> {
    let direction = direction
        .map(GraphqlSortDirection::into_model)
        .unwrap_or_default();
    if direction == SoupSortDirection::Asc && matches!(cursor, SoupQuery::Notified(_)) {
        return Err(async_graphql::Error::new(
            "sortDirection ASC is not supported with NOTIFIED_AT",
        ));
    }
    Ok(direction)
}

/// Convert the optional GraphQL expansion flag into the domain representation.
fn soup_type(expand: Option<bool>) -> SoupType {
    match expand {
        Some(false) => SoupType::UnExpanded,
        Some(true) | None => SoupType::Expanded,
    }
}

/// Convert the optional GraphQL email view into the domain representation.
fn email_preview_view(
    email_view: Option<GraphqlEmailView>,
) -> async_graphql::Result<email::domain::models::PreviewView> {
    email_view
        .map(GraphqlEmailView::as_preview_view_str)
        .unwrap_or("inbox")
        .parse()
        .map_err(async_graphql::Error::new)
}

/// GraphQL input representing the email view.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlEmailView {
    /// The inbox option.
    Inbox,
    /// The drafts option.
    Drafts,
    /// The sent option.
    Sent,
    /// The all option.
    All,
    /// The starred option.
    Starred,
    /// The important option.
    Important,
    /// The other option.
    Other,
}

impl GraphqlEmailView {
    /// Return the corresponding email preview view name.
    fn as_preview_view_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Drafts => "drafts",
            Self::Sent => "sent",
            Self::All => "all",
            Self::Starred => "starred",
            Self::Important => "important",
            Self::Other => "other",
        }
    }
}

// Filter input types and their authoritative materialization live in
// `graphql_soup_filter_input`, shared with the browser cache composition root.

/// GraphQL representation of supported Soup timestamp, notification, and task due-date sorts.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSimpleSortMethod {
    /// Sort by most recently viewed.
    ViewedAt,
    /// Sort by creation timestamp.
    CreatedAt,
    /// Sort by update timestamp.
    UpdatedAt,
    /// Sort by viewed timestamp, falling back to updated timestamp.
    ViewedUpdated,
    /// Only entities the caller holds a live notification for, most recently
    /// notified first. Descending `soup` only; not supported by `groupSoup`.
    NotifiedAt,
    /// Earliest task due date first, with undated tasks last.
    DueDateEarliest,
    /// Latest task due date first, with undated tasks last.
    DueDateLatest,
}

impl GraphqlSimpleSortMethod {
    /// Convert into a grouped sort, rejecting the flat-only notification mode.
    pub fn into_model(self) -> async_graphql::Result<GroupedSortMethod> {
        Ok(match self {
            Self::ViewedAt => GroupedSortMethod::Timestamp(SimpleSortMethod::ViewedAt),
            Self::CreatedAt => GroupedSortMethod::Timestamp(SimpleSortMethod::CreatedAt),
            Self::UpdatedAt => GroupedSortMethod::Timestamp(SimpleSortMethod::UpdatedAt),
            Self::ViewedUpdated => GroupedSortMethod::Timestamp(SimpleSortMethod::ViewedUpdated),
            Self::DueDateEarliest => GroupedSortMethod::DueDate(DueDateSort::Earliest),
            Self::DueDateLatest => GroupedSortMethod::DueDate(DueDateSort::Latest),
            Self::NotifiedAt => {
                return Err(async_graphql::Error::new(
                    "NOTIFIED_AT is only supported by soup",
                ));
            }
        })
    }

    /// Build a timestamp, notification, or nullable due-date initial query.
    fn into_query<T>(self, filters: T) -> async_graphql::Result<SoupQuery<T>> {
        if matches!(self, Self::NotifiedAt) {
            return Ok(SoupQuery::new_sort_notified(filters));
        }
        Ok(match self.into_model()? {
            GroupedSortMethod::Timestamp(sort) => SoupQuery::new_sort_simple(sort, filters),
            GroupedSortMethod::DueDate(sort) => SoupQuery::new_sort_due_date(sort, filters),
        })
    }
}

#[cfg(test)]
mod tests;
