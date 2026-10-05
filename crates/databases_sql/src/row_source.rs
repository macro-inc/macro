//! The engine's row source on the server: table rows read through Soup with
//! the browser's filters (newest first, as there), and `people` from contacts.

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use contacts::domain::ports::ContactsService;
use database_sql::catalog::{Catalog, ColumnKind, PEOPLE_EMAIL, PEOPLE_ID, PEOPLE_NAME};
use database_sql::fold::{Bin, Cell, Row};
use database_sql::run::{Page, RowSource};
use database_sql::split::{GqlQuery, KeyHint};
use email::domain::models::PreviewView;
use filter_ast::Expr;
use item_filters::ast::calendar_event::CalendarEventLiteral;
use item_filters::ast::call::CallLiteral;
use item_filters::ast::channel::{ChannelLiteral, ChannelThreadLiteral};
use item_filters::ast::chat::ChatLiteral;
use item_filters::ast::crm_company::CrmCompanyLiteral;
use item_filters::ast::database_row::DatabaseRowLiteral;
use item_filters::ast::document::DocumentLiteral;
use item_filters::ast::email::EmailLiteral;
use item_filters::ast::foreign_entity::ForeignEntityLiteral;
use item_filters::ast::project::ProjectLiteral;
use item_filters::ast::properties::{
    EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue,
};
use item_filters::ast::{EmailFilterAst, EntityFilterAst};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::position::PositionError;
use models_databases::{OptionId, RowId, TableId};
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{
    Base64SerdeErr, Base64Str, CursorWithValAndFilter, Query, SimpleSortMethod, TypeEraseCursor,
};
use models_properties::service::property_value::PropertyValue;
use models_soup::item::SoupItem;
use soup::domain::models::{
    GroupedSortRequest, SoupErr, SoupPropertiesField, SoupQuery, SoupRequest, SoupSortDirection,
    SoupType,
};
use soup::domain::ports::SoupService;
use uuid::Uuid;

/// The rows of a statement's tables as `viewer` may read them.
pub(crate) struct SoupRowSource<'statement, Soup, Contacts> {
    pub(crate) soup: &'statement Soup,
    pub(crate) contacts: &'statement Contacts,
    pub(crate) viewer: &'statement MacroUserIdStr<'static>,
    /// The statement's catalog, for the value kinds of grouped columns.
    pub(crate) catalog: &'statement Catalog,
}

/// Why the server's row source could not answer a read.
#[derive(Debug, thiserror::Error)]
pub(crate) enum SoupSourceError {
    /// Soup failed to read a table.
    #[error("Soup could not read table {table}")]
    Soup {
        /// The table.
        table: TableId,
        /// Soup's failure.
        #[source]
        source: SoupErr,
    },
    /// The viewer's contacts, the rows of `people`, could not be listed.
    #[error("the viewer's contacts could not be listed")]
    Contacts(rootcause::Report),
    /// A page cursor is not one Soup minted.
    #[error("the page cursor is not one Soup minted")]
    BadCursor(#[source] Base64SerdeErr<serde_json::Error>),
    /// A page asked for more rows than Soup pages hold.
    #[error("a page of {limit} rows is more than Soup returns at once")]
    PageTooLarge {
        /// The rows asked for.
        limit: usize,
    },
    /// A table query returned something other than one of its rows.
    #[error("a table query returned {entity}")]
    NotATableRow {
        /// What came back.
        entity: String,
    },
    /// A select column's bin is keyed by something other than an option id.
    #[error("bin key {key} is not an option id")]
    BinKeyNotAnOption {
        /// The key.
        key: String,
        /// Why it is not an id.
        #[source]
        source: uuid::Error,
    },
    /// Soup returned one group twice.
    #[error("Soup returned the group {key} twice")]
    RepeatedGroup {
        /// The group's key.
        key: String,
    },
    /// A grouped read named a column Soup cannot bin on.
    #[error("column {column} cannot be grouped by Soup")]
    UngroupableColumn {
        /// The column.
        column: Uuid,
    },
    /// A grouped read named a column its table does not have.
    #[error("no column {column} in table {table}")]
    UnknownGroupColumn {
        /// The table.
        table: TableId,
        /// The column.
        column: Uuid,
    },
    /// A row's stored position is not a fractional key.
    #[error("row {row} has a position that is not a key")]
    BadPosition {
        /// The row.
        row: RowId,
        /// Why it is not a key.
        #[source]
        source: PositionError,
    },
    /// A page was asked of a grouped query, which is read as bins.
    #[error("a grouped query is read as bins, not pages")]
    PageOfGroupedQuery,
    /// Bins were asked of a query that does not group.
    #[error("only a grouped query has bins")]
    BinsOfUngroupedQuery,
}

impl SoupSourceError {
    /// The failure as a report, keeping the chain beneath it.
    pub(crate) fn into_report(self) -> rootcause::Report {
        match self {
            SoupSourceError::Contacts(report) => report
                .context("the viewer's contacts could not be listed")
                .into_dynamic(),
            other => rootcause::Report::new(other).into_dynamic(),
        }
    }
}

impl<Soup, Contacts> RowSource for SoupRowSource<'_, Soup, Contacts>
where
    Soup: SoupService,
    Contacts: ContactsService,
{
    type Error = SoupSourceError;

    async fn page(
        &self,
        query: &GqlQuery,
        _needs: &[Uuid],
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Page, Self::Error> {
        match query {
            GqlQuery::Soup {
                table,
                property_filter,
                key_hint,
            } => {
                self.soup_page(
                    *table,
                    property_filter.as_ref(),
                    key_hint.as_ref(),
                    cursor,
                    limit,
                )
                .await
            }
            GqlQuery::People { ids } => self.people_page(ids.as_deref()).await,
            GqlQuery::GroupSoup { .. } => Err(SoupSourceError::PageOfGroupedQuery),
        }
    }

    async fn bins(&self, query: &GqlQuery) -> Result<Vec<Bin>, Self::Error> {
        let GqlQuery::GroupSoup {
            table,
            property_filter,
            group_by,
        } = query
        else {
            return Err(SoupSourceError::BinsOfUngroupedQuery);
        };
        let kind = self
            .catalog
            .tables
            .iter()
            .find(|candidate| candidate.id == *table)
            .and_then(|table| table.columns.iter().find(|column| column.id == *group_by))
            .map(|column| &column.kind)
            .ok_or(SoupSourceError::UnknownGroupColumn {
                table: *table,
                column: *group_by,
            })?;
        let request = GroupedSortRequest {
            // The bins' totals answer the count; one item each is enough.
            limit: 1,
            cursor: Query::Sort(
                SimpleSortMethod::CreatedAt,
                rows_filter(*table, property_filter.as_ref(), None),
            ),
            user_id: self.viewer.clone(),
            grouping: GroupingConfig {
                field: GroupByField::Property {
                    property_definition_id: *group_by,
                    entity_type: Some(PropertyEntityType::DatabaseRow.to_string()),
                },
                group_key: None,
                per_group_limit: Some(1),
            },
        };
        let items = self
            .soup
            .get_user_soup_grouped(request)
            .await
            .map_err(|source| SoupSourceError::Soup {
                table: *table,
                source,
            })?;
        let mut bins: Vec<Bin> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        // Soup numbers a group's items from 1; only its first carries the bin.
        for item in items.filter(|item| item.index_in_group == 1) {
            if !seen.insert(item.key.clone()) {
                return Err(SoupSourceError::RepeatedGroup { key: item.key });
            }
            bins.push(Bin {
                key: bin_key(kind, &item.key, *group_by)?,
                count: item.total_group_count as u64,
            });
        }
        Ok(bins)
    }
}

impl<Soup, Contacts> SoupRowSource<'_, Soup, Contacts>
where
    Soup: SoupService,
    Contacts: ContactsService,
{
    async fn soup_page(
        &self,
        table: TableId,
        property_filter: Option<&Expr<PropertiesLiteral>>,
        key_hint: Option<&KeyHint>,
        cursor: Option<String>,
        limit: usize,
    ) -> Result<Page, SoupSourceError> {
        let cursor = match cursor {
            None => SoupQuery::new_sort_simple(
                SimpleSortMethod::CreatedAt,
                rows_filter(table, property_filter, key_hint),
            ),
            Some(cursor) => SoupQuery::new_cursor_simple(
                Base64Str::<CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>>::new_from_string(cursor)
                    .decode_json()
                    .map_err(SoupSourceError::BadCursor)?,
            ),
        };
        let request = SoupRequest {
            soup_type: SoupType::Expanded,
            limit: u16::try_from(limit).map_err(|_| SoupSourceError::PageTooLarge { limit })?,
            cursor,
            sort_direction: SoupSortDirection::Desc,
            user: self.viewer.clone(),
            // Every other kind is excluded, so emails never come into play.
            email_preview_view: PreviewView::default(),
            link_ids: Vec::new(),
        };
        let page = self
            .soup
            .get_user_soup_with_properties(request, None)
            .await
            .map_err(|source| SoupSourceError::Soup { table, source })?
            .type_erase();
        Ok(Page {
            rows: page
                .items
                .into_iter()
                .map(|enriched| table_row(enriched.item))
                .collect::<Result<_, _>>()?,
            next: page.next_cursor,
        })
    }

    async fn people_page(&self, ids: Option<&[String]>) -> Result<Page, SoupSourceError> {
        let people = self
            .contacts
            .query_contacts(self.viewer.clone())
            .await
            .map_err(SoupSourceError::Contacts)?;
        let wanted: Option<HashSet<&str>> = ids.map(|ids| ids.iter().map(String::as_str).collect());
        Ok(Page {
            rows: people
                .into_iter()
                .filter(|person| {
                    wanted
                        .as_ref()
                        .is_none_or(|wanted| wanted.contains(person.as_ref()))
                })
                .map(|person| person_row(&person))
                .collect(),
            next: None,
        })
    }
}

/// One person as a `people` row. People have no row ids of their own, so
/// the row is named by its user id in the OID namespace, as the browser
/// names it.
fn person_row(person: &MacroUserIdStr<'_>) -> Row {
    let id: &str = person.as_ref();
    let email = person.email_str().to_owned();
    let name = email.split('@').next().unwrap_or_default().to_owned();
    Row {
        id: RowId::from_uuid(Uuid::new_v5(&Uuid::NAMESPACE_OID, id.as_bytes())),
        position: None,
        cells: HashMap::from([
            (PEOPLE_ID, Cell::Entities(vec![id.to_owned()])),
            (PEOPLE_NAME, Cell::Text(name)),
            (PEOPLE_EMAIL, Cell::Text(email)),
        ]),
    }
}

/// A grouped key as the engine reads it. Soup files rows with an empty cell
/// under the empty key.
fn bin_key(kind: &ColumnKind, key: &str, column: Uuid) -> Result<Option<Cell>, SoupSourceError> {
    if key.is_empty() {
        return Ok(None);
    }
    match kind {
        ColumnKind::Select { .. } => key
            .parse::<OptionId>()
            .map(|option| Some(Cell::Options(vec![option])))
            .map_err(|source| SoupSourceError::BinKeyNotAnOption {
                key: key.to_owned(),
                source,
            }),
        ColumnKind::Entity { .. } => Ok(Some(Cell::Entities(vec![key.to_owned()]))),
        _ => Err(SoupSourceError::UngroupableColumn { column }),
    }
}

/// Rows of one table and nothing else, with the pushed-down filter and the
/// join's narrowing.
fn rows_filter(
    table: TableId,
    property_filter: Option<&Expr<PropertiesLiteral>>,
    key_hint: Option<&KeyHint>,
) -> EntityFilterAst {
    let mut rows = Expr::val(DatabaseRowLiteral::TableId(table.into_uuid()));
    let mut properties = property_filter.cloned();
    match key_hint.and_then(narrowing) {
        Some(Narrowing::Rows(ids)) => rows = Expr::and(rows, ids),
        Some(Narrowing::Properties(values)) => {
            properties = Some(match properties {
                Some(properties) => Expr::and(properties, values),
                None => values,
            });
        }
        None => {}
    }
    EntityFilterAst {
        favorites_only: None,
        calendar_event_filter: Some(Arc::new(Expr::val(CalendarEventLiteral::Id(Uuid::nil())))),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::Id(Uuid::nil())))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
            Uuid::nil(),
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
        email_filter: EmailFilterAst {
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
        github_pull_request_filter: None,
        // Reminders, agent sessions and initiatives are opt-in: left empty,
        // they are excluded.
        agent_session_filter: None,
        initiative_filter: None,
        database_row_filter: Some(Arc::new(rows)),
        properties_filter: properties.map(Arc::new),
    }
}

enum Narrowing {
    Rows(Expr<DatabaseRowLiteral>),
    Properties(Expr<PropertiesLiteral>),
}

/// A filter fetching only the joined rows the join can match. The fold
/// applies the join regardless, so a hint that cannot be expressed fetches
/// the whole table instead. The engine leaves out a hint too long to be
/// worth narrowing by.
fn narrowing(hint: &KeyHint) -> Option<Narrowing> {
    enum Member<'hint> {
        Entity(&'hint str),
        Row(RowId),
        Option(OptionId),
    }
    let mut members = Vec::new();
    for value in &hint.values {
        match value {
            Cell::Entities(ids) => members.extend(ids.iter().map(|id| Member::Entity(id))),
            Cell::Row(id) => members.push(Member::Row(*id)),
            Cell::Options(ids) => members.extend(ids.iter().copied().map(Member::Option)),
            _ => return None,
        }
    }
    if members.is_empty() {
        return None;
    }
    match hint.column {
        None => {
            let ids = members
                .iter()
                .map(|member| match member {
                    Member::Entity(id) => Uuid::parse_str(id).ok(),
                    Member::Row(id) => Some(id.into_uuid()),
                    Member::Option(id) => Some(id.into_uuid()),
                })
                .collect::<Option<Vec<Uuid>>>()?;
            balanced_or(
                ids.into_iter()
                    .map(|id| Expr::val(DatabaseRowLiteral::Id(id)))
                    .collect(),
            )
            .map(Narrowing::Rows)
        }
        Some(column) => {
            let literals = members
                .iter()
                .map(|member| {
                    let value = match member {
                        Member::Entity(id) => {
                            PropertyMatchValue::EntityRef(EntityRefId::new((*id).to_owned()).ok()?)
                        }
                        Member::Row(id) => {
                            PropertyMatchValue::EntityRef(EntityRefId::new(id.to_string()).ok()?)
                        }
                        Member::Option(id) => PropertyMatchValue::SelectOption(id.into_uuid()),
                    };
                    Some(Expr::val(PropertiesLiteral {
                        property_definition_id: column,
                        entity_type: None,
                        value,
                    }))
                })
                .collect::<Option<Vec<_>>>()?;
            balanced_or(literals).map(Narrowing::Properties)
        }
    }
}

/// A balanced OR keeps a long list shallow.
fn balanced_or<Literal>(mut items: Vec<Expr<Literal>>) -> Option<Expr<Literal>> {
    if items.len() < 2 {
        return items.pop();
    }
    let right = items.split_off(items.len() / 2);
    Some(Expr::or(balanced_or(items)?, balanced_or(right)?))
}

fn table_row(item: SoupItem<SoupPropertiesField>) -> Result<Row, SoupSourceError> {
    let SoupItem::DatabaseRow(row) = item else {
        return Err(SoupSourceError::NotATableRow {
            entity: format!("{:?}", item.entity()),
        });
    };
    let id = RowId::from_uuid(row.id);
    Ok(Row {
        id,
        position: Some(
            row.position
                .parse()
                .map_err(|source| SoupSourceError::BadPosition { row: id, source })?,
        ),
        cells: row
            .extra
            .properties
            .into_iter()
            .filter_map(|property| Some((property.definition.id, cell(property.value?))))
            .collect(),
    })
}

/// A property value as the engine reads it, matching the browser's source.
fn cell(value: PropertyValue) -> Cell {
    match value {
        PropertyValue::Bool(value) => Cell::Bool(value),
        PropertyValue::Num(value) => Cell::Number(value),
        PropertyValue::Str(value) => Cell::Text(value),
        PropertyValue::Date(value) => Cell::Date(value),
        PropertyValue::SelectOption(ids) => {
            Cell::Options(ids.into_iter().map(OptionId::from_uuid).collect())
        }
        PropertyValue::EntityRef(references) => Cell::Entities(
            references
                .into_iter()
                .map(|reference| reference.entity_id)
                .collect(),
        ),
        PropertyValue::Link(urls) => Cell::Text(urls.join(" ")),
    }
}
