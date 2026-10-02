//! The engine's transcripts (`crates/database_sql/fixtures/transcripts`),
//! replayed through this source over a Soup that answers each read with the
//! page the transcript fed, as the browser's GraphQL source replays them:
//! every statement must reach the transcript's outcome, and each read must be
//! the Soup query its fetch asks for.

use std::collections::VecDeque;
use std::sync::Mutex;

use chrono::Utc;
use contacts::domain::models::messages::ContactsNodes;
use database_sql::catalog::Catalog;
use database_sql::fold::Bin;
use database_sql::run::{OpsSink, Outcome};
use models_databases::{DatabaseId, DatabaseOp, OpResult, OptionId, RowId, TableId};
use models_pagination::{Base64Str, Cursor, CursorVal, Paginated};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::shared::{DataType, EntityReference, PropertyOwner};
use models_soup::database_row::SoupDatabaseRow;
use models_soup::properties::SoupProperty;
use serde::Deserialize;
use soup::domain::models::grouping::ItemGroupingInfo;
use soup::domain::models::{EnrichedSoupItem, IntoSoupReqAst, SoupErr};
use soup::domain::ports::SoupOutput;

use super::*;

#[derive(Deserialize)]
struct Transcript {
    catalog: Catalog,
    sql: String,
    exchanges: Vec<Exchange>,
    outcome: Outcome,
}

#[derive(Deserialize)]
struct Exchange {
    step: serde_json::Value,
    #[serde(default)]
    page: Option<Page>,
    #[serde(default)]
    bins: Option<Vec<Bin>>,
    #[serde(default)]
    results: Option<Vec<OpResult>>,
}

fn transcript(name: &str) -> Transcript {
    let path = format!(
        "{}/../database_sql/fixtures/transcripts/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|error| panic!("{path}: {error}"));
    serde_json::from_str(&text).unwrap_or_else(|error| panic!("{path}: {error}"))
}

/// Answers Soup reads with the transcript's pages and bins, in order,
/// recording the filter of each read.
struct ReplaySoup {
    pages: Mutex<VecDeque<Page>>,
    bins: Mutex<VecDeque<Vec<Bin>>>,
    reads: Mutex<Vec<EntityFilterAst>>,
}

impl ReplaySoup {
    fn new(transcript: &Transcript) -> Self {
        Self {
            pages: Mutex::new(
                transcript
                    .exchanges
                    .iter()
                    .filter_map(|exchange| exchange.page.clone())
                    .collect(),
            ),
            bins: Mutex::new(
                transcript
                    .exchanges
                    .iter()
                    .filter_map(|exchange| exchange.bins.clone())
                    .collect(),
            ),
            reads: Mutex::new(Vec::new()),
        }
    }
}

/// A transcript row as Soup returns it: its cells as properties.
fn soup_row(row: &Row) -> SoupItem<SoupPropertiesField> {
    SoupItem::DatabaseRow(SoupDatabaseRow {
        id: row.id.into_uuid(),
        table_id: Uuid::nil(),
        database_id: Uuid::nil(),
        position: row
            .position
            .as_ref()
            .map(ToString::to_string)
            .unwrap_or_default(),
        owner_id: model_owner::Owner::User(
            MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap(),
        ),
        created_by: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        extra: SoupPropertiesField::new(
            row.cells
                .iter()
                .map(|(definition, cell)| SoupProperty {
                    id: Uuid::new_v4(),
                    definition: PropertyDefinition {
                        id: *definition,
                        owner: PropertyOwner::System,
                        display_name: String::new(),
                        data_type: DataType::String,
                        is_multi_select: false,
                        specific_entity_type: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                        is_system: false,
                        is_metadata: false,
                    },
                    value: Some(match cell {
                        Cell::Text(text) => PropertyValue::Str(text.clone()),
                        Cell::Number(number) => PropertyValue::Num(*number),
                        Cell::Bool(checked) => PropertyValue::Bool(*checked),
                        Cell::Date(date) => PropertyValue::Date(*date),
                        Cell::Options(ids) => PropertyValue::SelectOption(
                            ids.iter().map(|id| id.into_uuid()).collect(),
                        ),
                        Cell::Entities(ids) => PropertyValue::EntityRef(
                            ids.iter()
                                .map(|id| EntityReference {
                                    entity_id: id.clone(),
                                    entity_type: models_properties::EntityType::DatabaseRow,
                                    specific_message_id: None,
                                })
                                .collect(),
                        ),
                        Cell::Row(_) => unreachable!("a stored row holds no row_id cell"),
                    }),
                })
                .collect(),
        ),
    })
}

impl SoupService for ReplaySoup {
    async fn get_user_soup_with_properties<T>(
        &self,
        request: SoupRequest<T>,
        _team_receipt: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        let continued = request.cursor.filter().clone();
        let request = request.into_ast().map_err(SoupErr::AstErr)?;
        let filter = request.cursor.filter().clone().expect("a table read");
        self.reads.lock().unwrap().push(filter);
        let page = self
            .pages
            .lock()
            .unwrap()
            .pop_front()
            .expect("the engine reads no more pages than the transcript fed");
        Ok(SoupOutput::Simple(Paginated::from_parts(
            page.rows
                .iter()
                .map(|row| EnrichedSoupItem::from(soup_row(row)))
                .collect(),
            page.next.as_ref().and(page.rows.last()).map(|last| {
                Base64Str::encode_json(Cursor {
                    id: last.id.to_string(),
                    limit: page.rows.len(),
                    val: CursorVal {
                        sort_type: SimpleSortMethod::CreatedAt,
                        last_val: Utc::now(),
                    },
                    filter: continued.clone(),
                })
            }),
        )))
    }

    async fn get_user_soup_grouped(
        &self,
        request: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        self.reads
            .lock()
            .unwrap()
            .push(request.cursor.filter().clone());
        let bins = self
            .bins
            .lock()
            .unwrap()
            .pop_front()
            .expect("the engine asks for the transcript's bins");
        Ok(bins
            .into_iter()
            .map(|bin| ItemGroupingInfo {
                key: match bin.key {
                    None => String::new(),
                    Some(Cell::Options(ids)) => ids[0].to_string(),
                    Some(Cell::Entities(ids)) => ids[0].clone(),
                    Some(other) => panic!("Soup does not group by {other:?}"),
                },
                total_group_count: bin.count as usize,
                // Soup numbers a group's items from 1.
                index_in_group: 1,
                item: soup_row(&Row {
                    id: RowId::new(),
                    position: None,
                    cells: HashMap::new(),
                }),
            })
            .collect::<Vec<_>>()
            .into_iter())
    }

    async fn get_user_soup<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("rows are read with their properties")
    }
    async fn get_user_soup_with_frecency<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("rows never read frecency")
    }
    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _: SoupRequest<T>,
        _: Option<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::MemberTeamRole,
            >,
        >,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        unimplemented!("rows never read frecency")
    }
    async fn caller_tag_sets<'a>(
        &self,
        _: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        unimplemented!("rows never read tag sets")
    }
}

/// The transcripts read no people.
struct NoContacts;

impl ContactsService for NoContacts {
    async fn query_contacts(
        &self,
        _: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        unimplemented!("no transcript reads people")
    }
    async fn add_contact_nodes(&self, _: ContactsNodes) -> Result<(), rootcause::Report> {
        unimplemented!("no transcript adds contacts")
    }
}

/// Takes the transcript's ops and answers its results.
struct ReplaySink {
    exchanges: Mutex<VecDeque<(Vec<DatabaseOp>, Vec<OpResult>)>>,
}

impl ReplaySink {
    fn new(transcript: &Transcript) -> Self {
        Self {
            exchanges: Mutex::new(
                transcript
                    .exchanges
                    .iter()
                    .filter_map(|exchange| {
                        let ops = serde_json::from_value(exchange.step.get("ops")?.clone())
                            .expect("transcript ops");
                        Some((ops, exchange.results.clone()?))
                    })
                    .collect(),
            ),
        }
    }
}

impl OpsSink for ReplaySink {
    type Error = std::convert::Infallible;

    async fn apply(
        &self,
        _database: DatabaseId,
        ops: Vec<DatabaseOp>,
    ) -> Result<Vec<OpResult>, Self::Error> {
        let (expected, results) = self
            .exchanges
            .lock()
            .unwrap()
            .pop_front()
            .expect("the engine writes no more than the transcript");
        assert_eq!(ops, expected);
        Ok(results)
    }
}

/// Replay `name` and answer the filters of its reads.
async fn replay(name: &str) -> Vec<EntityFilterAst> {
    let transcript = transcript(name);
    let soup = ReplaySoup::new(&transcript);
    let viewer = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    let source = SoupRowSource {
        soup: &soup,
        contacts: &NoContacts,
        viewer: &viewer,
        catalog: &transcript.catalog,
    };
    let outcome = database_sql::run(
        &transcript.catalog,
        &transcript.sql,
        &source,
        &ReplaySink::new(&transcript),
    )
    .await
    .unwrap_or_else(|error| panic!("{name}: {error}"));
    assert_eq!(outcome, transcript.outcome, "{name}");
    assert!(
        soup.pages.lock().unwrap().is_empty(),
        "{name}: unread pages"
    );
    soup.reads.into_inner().unwrap()
}

const DEALS: TableId = TableId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000d001));
const PEOPLE: TableId = TableId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000d002));
const STAGE: Uuid = Uuid::from_u128(0x01990000_0000_7000_8000_00000000c003);
const WON: OptionId = OptionId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000a002));
const SAM: RowId = RowId::from_uuid(Uuid::from_u128(0x01990000_0000_7000_8000_00000000f001));

#[tokio::test]
async fn every_transcript_reaches_its_outcome_through_soup() {
    for name in [
        "alter-column",
        "count-per-option",
        "delete-where",
        "insert-two-rows",
        "join",
        "left-join-where",
        "paging",
        "row-position",
        "select-column-filter",
        "update-per-row",
        "update-uniform",
    ] {
        replay(name).await;
    }
}

#[tokio::test]
async fn a_table_read_is_its_rows_and_nothing_else() {
    let reads = replay("paging").await;
    // The second page continues the first, from its cursor.
    assert_eq!(reads.len(), 2);
    assert_eq!(
        serde_json::to_value(&reads[0]).unwrap(),
        serde_json::to_value(&reads[1]).unwrap()
    );
    assert_eq!(
        reads[0].database_row_filter,
        Some(Arc::new(Expr::val(DatabaseRowLiteral::TableId(
            DEALS.into_uuid()
        ))))
    );
    assert_eq!(reads[0].properties_filter, None);
    // Every other kind is excluded the way the browser excludes it.
    assert_eq!(
        serde_json::to_value(&reads[0]).unwrap(),
        serde_json::json!({
            "calf": {"l": {"id": Uuid::nil()}},
            "df": {"l": {"id": Uuid::nil()}},
            "pf": {"l": {"pids": Uuid::nil()}},
            "cf": {"l": {"cid": Uuid::nil()}},
            "ef": {"t": {"l": {"ThreadId": Uuid::nil()}}},
            "chanf": {"l": {"ChannelId": Uuid::nil()}},
            "cthf": {"l": {"ThreadId": Uuid::nil()}},
            "callf": {"l": {"CallId": Uuid::nil()}},
            "ccf": {"l": {"id": Uuid::nil()}},
            "fef": {"l": {"id": Uuid::nil()}},
            "remf": null,
            "asf": null,
            "if": null,
            "drf": {"l": {"t": DEALS}},
            "propf": null,
        })
    );
}

#[tokio::test]
async fn a_pushed_down_filter_is_the_soup_properties_filter() {
    let reads = replay("select-column-filter").await;
    assert_eq!(reads.len(), 1);
    assert_eq!(
        reads[0].database_row_filter,
        Some(Arc::new(Expr::val(DatabaseRowLiteral::TableId(
            DEALS.into_uuid()
        ))))
    );
    assert_eq!(
        reads[0].properties_filter,
        Some(Arc::new(Expr::val(PropertiesLiteral {
            property_definition_id: STAGE,
            entity_type: None,
            value: PropertyMatchValue::SelectOption(WON.into_uuid()),
        })))
    );
}

#[tokio::test]
async fn a_join_reads_only_the_joined_rows_it_can_match() {
    let reads = replay("join").await;
    assert_eq!(reads.len(), 2);
    assert_eq!(
        reads[0].database_row_filter,
        Some(Arc::new(Expr::val(DatabaseRowLiteral::TableId(
            DEALS.into_uuid()
        ))))
    );
    assert_eq!(
        reads[1].database_row_filter,
        Some(Arc::new(Expr::and(
            Expr::val(DatabaseRowLiteral::TableId(PEOPLE.into_uuid())),
            Expr::val(DatabaseRowLiteral::Id(SAM.into_uuid())),
        )))
    );
}

#[tokio::test]
async fn a_count_per_option_reads_one_bin_per_option() {
    let reads = replay("count-per-option").await;
    assert_eq!(reads.len(), 1);
    assert_eq!(
        serde_json::to_value(&reads[0]).unwrap(),
        serde_json::to_value(rows_filter(DEALS, None, None)).unwrap()
    );
}
