use std::sync::Mutex;

use super::*;

/// Index proposals and Postgres state for one search, recording what the
/// search read.
#[derive(Default)]
struct FakeSource {
    viewable_databases: Vec<Uuid>,
    /// Every row the index holds, in its order.
    index: Vec<ProposedRow>,
    viewable: HashSet<Uuid>,
    current: Vec<CurrentRow>,
    proposal_requests: Mutex<Vec<(Option<RowPosition>, u32)>>,
    current_reads: Mutex<Vec<Uuid>>,
}

impl DatabaseRowSource for FakeSource {
    async fn viewable_database_ids(
        &self,
        _user: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Vec<Uuid>, Report> {
        Ok(self.viewable_databases.clone())
    }

    async fn propose(&self, request: ProposalRequest<'_>) -> Result<Vec<ProposedRow>, Report> {
        self.proposal_requests
            .lock()
            .expect("lock")
            .push((request.after, request.limit));
        let start = match request.after {
            None => 0,
            Some(after) => {
                self.index
                    .iter()
                    .position(|row| row.position == after)
                    .expect("cursor names an indexed row")
                    + 1
            }
        };
        Ok(self
            .index
            .iter()
            .skip(start)
            .take(request.limit as usize)
            .copied()
            .collect())
    }

    async fn viewable_rows(
        &self,
        _user: &MacroUserId<Lowercase<'_>>,
        row_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        Ok(row_ids
            .iter()
            .copied()
            .filter(|row_id| self.viewable.contains(row_id))
            .collect())
    }

    async fn current_rows(&self, row_ids: &[Uuid]) -> Result<Vec<CurrentRow>, Report> {
        self.current_reads
            .lock()
            .expect("lock")
            .extend(row_ids.iter().copied());
        Ok(self
            .current
            .iter()
            .filter(|row| row_ids.contains(&row.row_id))
            .cloned()
            .collect())
    }
}

const DATABASE: Uuid = Uuid::from_u128(0xd0);
const TABLE: Uuid = Uuid::from_u128(0x70);

fn row_id(n: u128) -> Uuid {
    Uuid::from_u128(0x1000 + n)
}

fn position(n: u128) -> RowPosition {
    RowPosition {
        // Newest first: a later row in the index was written earlier.
        updated_at: DateTime::from_timestamp_millis(1_763_000_000_000 - n as i64 * 1000)
            .expect("time"),
        row_id: row_id(n),
    }
}

fn proposed(n: u128) -> ProposedRow {
    ProposedRow {
        row_id: row_id(n),
        position: position(n),
    }
}

fn current(n: u128, title: &str, cells: &[&str]) -> CurrentRow {
    CurrentRow {
        row_id: row_id(n),
        table_id: TABLE,
        database_id: DATABASE,
        database_name: "Accounts".to_string(),
        table_name: "Customers".to_string(),
        title: title.to_string(),
        cell_text: cells.iter().map(|cell| cell.to_string()).collect(),
        updated_at: position(n).updated_at,
    }
}

fn user() -> MacroUserId<Lowercase<'static>> {
    MacroUserId::parse_from_str("macro|reader@example.com")
        .expect("user id")
        .lowercase()
}

fn terms(words: &[&str]) -> (Vec<String>, RowQuery) {
    let terms: Vec<String> = words.iter().map(|word| word.to_string()).collect();
    let query = RowQuery::new(&terms, RowMatchType::Partial).expect("query");
    (terms, query)
}

async fn page(source: FakeSource, limit: u32, after: Option<RowPosition>) -> (RowPage, FakeSource) {
    let (terms, query) = terms(&["acme"]);
    let search = DatabaseRowSearch(source);
    let page = search
        .page(&user(), &query, &terms, limit, after)
        .await
        .expect("page");
    (page, search.0)
}

#[tokio::test]
async fn shows_a_viewable_matching_row_with_its_current_title_and_snippet() {
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1)],
        viewable: HashSet::from([row_id(1)]),
        current: vec![current(
            1,
            "Acme Corp",
            &["Acme Corp", "Renewal with Acme in May"],
        )],
        ..Default::default()
    };

    let (page, _) = page(source, 10, None).await;

    assert_eq!(
        page.rows,
        vec![ShownRow {
            position: position(1),
            item: DatabaseRowSearchResponseItem {
                database_id: DATABASE,
                table_id: TABLE,
                row_id: row_id(1),
                database_name: "Accounts".to_string(),
                table_name: "Customers".to_string(),
                title: "Acme Corp".to_string(),
                snippet: Some("Renewal with <macro_em>Acme</macro_em> in May".to_string()),
                updated_at: position(1).updated_at,
            },
        }]
    );
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn a_row_matched_only_by_its_title_has_no_snippet() {
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1)],
        viewable: HashSet::from([row_id(1)]),
        current: vec![current(1, "Acme Corp", &["Acme Corp", "Renewal in May"])],
        ..Default::default()
    };

    let (page, _) = page(source, 10, None).await;

    assert_eq!(page.rows.len(), 1);
    assert_eq!(page.rows[0].item.snippet, None);
}

#[tokio::test]
async fn a_row_the_caller_cannot_view_is_dropped_without_reading_its_text() {
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1), proposed(2)],
        viewable: HashSet::from([row_id(2)]),
        current: vec![current(1, "Acme secret", &[]), current(2, "Acme Corp", &[])],
        ..Default::default()
    };

    let (page, source) = page(source, 10, None).await;

    let shown: Vec<Uuid> = page.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(2)]);
    assert_eq!(*source.current_reads.lock().expect("lock"), vec![row_id(2)]);
}

#[tokio::test]
async fn a_row_gone_from_postgres_is_dropped() {
    // A deleted row, a deleted table, a trashed database and CRM storage are
    // all rows `current_rows` leaves out.
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1), proposed(2)],
        viewable: HashSet::from([row_id(1), row_id(2)]),
        current: vec![current(2, "Acme Corp", &[])],
        ..Default::default()
    };

    let (page, _) = page(source, 10, None).await;

    let shown: Vec<Uuid> = page.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(2)]);
}

#[tokio::test]
async fn a_row_whose_current_text_no_longer_matches_is_dropped() {
    // The index still holds "Acme" for row 1, but its cell was edited.
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1)],
        viewable: HashSet::from([row_id(1)]),
        current: vec![current(1, "Globex", &["Globex", "Renewal in May"])],
        ..Default::default()
    };

    let (page, _) = page(source, 10, None).await;

    assert!(page.rows.is_empty());
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn no_viewable_database_reads_no_proposals() {
    let source = FakeSource {
        index: vec![proposed(1)],
        viewable: HashSet::from([row_id(1)]),
        current: vec![current(1, "Acme", &[])],
        ..Default::default()
    };

    let (page, source) = page(source, 10, None).await;

    assert!(page.rows.is_empty());
    assert!(source.proposal_requests.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_next_page_needs_a_shown_row_beyond_the_page() {
    // Two rows fit the page; the third proposal is one the caller cannot
    // view, so there is no next page.
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1), proposed(2), proposed(3)],
        viewable: HashSet::from([row_id(1), row_id(2)]),
        current: vec![
            current(1, "Acme one", &[]),
            current(2, "Acme two", &[]),
            current(3, "Acme hidden", &[]),
        ],
        ..Default::default()
    };

    let (page, _) = page(source, 2, None).await;

    assert_eq!(page.rows.len(), 2);
    assert_eq!(page.next, None);
}

#[tokio::test]
async fn the_next_page_resumes_after_the_last_row_shown() {
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index: vec![proposed(1), proposed(2), proposed(3), proposed(4)],
        viewable: HashSet::from([row_id(1), row_id(3), row_id(4)]),
        current: vec![
            current(1, "Acme one", &[]),
            current(3, "Acme three", &[]),
            current(4, "Acme four", &[]),
        ],
        ..Default::default()
    };

    let (first, source) = page(source, 2, None).await;

    let shown: Vec<Uuid> = first.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(1), row_id(3)]);
    assert_eq!(first.next, Some(position(3)));

    let (second, _) = page(source, 2, first.next).await;

    let shown: Vec<Uuid> = second.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(4)]);
    assert_eq!(second.next, None);
}

#[tokio::test]
async fn reads_further_proposals_until_the_page_is_full() {
    // The first read of 25 proposals holds one row the caller may view; the
    // page fills from the second read.
    let index: Vec<ProposedRow> = (1..=60).map(proposed).collect();
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index,
        viewable: HashSet::from([row_id(1), row_id(30), row_id(31)]),
        current: vec![
            current(1, "Acme one", &[]),
            current(30, "Acme thirty", &[]),
            current(31, "Acme thirty-one", &[]),
        ],
        ..Default::default()
    };

    let (page, source) = page(source, 2, None).await;

    let shown: Vec<Uuid> = page.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(1), row_id(30)]);
    assert_eq!(page.next, Some(position(30)));
    assert_eq!(
        *source.proposal_requests.lock().expect("lock"),
        vec![(None, 25), (Some(position(25)), 25)]
    );
    assert_eq!(page.stats.rounds, 2);
}

#[tokio::test]
async fn stops_at_the_round_bound_without_promising_a_next_page() {
    let index: Vec<ProposedRow> = (1..=200).map(proposed).collect();
    let source = FakeSource {
        viewable_databases: vec![DATABASE],
        index,
        viewable: HashSet::from([row_id(1), row_id(190)]),
        current: vec![current(1, "Acme one", &[]), current(190, "Acme far", &[])],
        ..Default::default()
    };

    let (page, _) = page(source, 2, None).await;

    let shown: Vec<Uuid> = page.rows.iter().map(|row| row.item.row_id).collect();
    assert_eq!(shown, vec![row_id(1)]);
    assert_eq!(page.next, None);
    assert_eq!(page.stats.rounds, MAX_ROUNDS);
    assert!(page.stats.bound_reached);
}
