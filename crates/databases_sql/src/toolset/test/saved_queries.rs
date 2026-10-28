use databases::domain::models::QueryDefinition;

use super::*;

const PARTY_SQL: &str =
    "SELECT \"Status\" AS status, COUNT(*) AS guests FROM \"Guests\" GROUP BY \"Status\"";

/// Three result columns, so a chart can split its one series by a third.
const NAMED_PARTY_SQL: &str = "SELECT \"Status\" AS status, COUNT(*) AS guests, \
     COUNT(\"Name\") AS named FROM \"Guests\" GROUP BY \"Status\"";

/// The block is the document node's payload, so its exact text is the
/// contract with the frontend.
#[tokio::test]
async fn saving_a_chart_question_returns_its_live_block() {
    let world = world();
    let response = SaveDatabaseQuery {
        database_id: Some(OFFSITE),
        sql: NAMED_PARTY_SQL.to_string(),
        title: "Guests by status".to_string(),
        display_mode: QueryDatabaseDisplay::Area,
        chart: Some(ToolChart {
            x: "status".to_string(),
            y: vec!["guests".to_string()],
            title: None,
            color: Some("named".to_string()),
            stack: Some(true),
        }),
        prompt: None,
    }
    .call(
        ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
        RequestContext::new(user(VIEWER)),
    )
    .await
    .expect("view access may save a question");

    assert_eq!(
        response.markdown,
        r#"<m-db-query>{"queryId":"00000000-0000-0000-0000-000000000e11","databaseId":"00000000-0000-0000-0000-00000000db01","title":"Guests by status","prompt":"Guests by status","displayMode":"area","chart":{"x":"status","y":["guests"],"color":"named","stack":true}}</m-db-query>"#
    );
    assert_eq!(
        world.lock().unwrap().saved,
        vec![(
            Some(OFFSITE),
            QueryDefinition::V1 {
                query: NAMED_PARTY_SQL.to_string(),
            }
        )]
    );
}

#[tokio::test]
async fn an_unstacked_chart_writes_no_stack() {
    let world = world();
    let response = SaveDatabaseQuery {
        database_id: Some(OFFSITE),
        sql: PARTY_SQL.to_string(),
        title: "Guests by status".to_string(),
        display_mode: QueryDatabaseDisplay::Scatter,
        chart: Some(ToolChart {
            x: "status".to_string(),
            y: vec!["guests".to_string()],
            title: None,
            color: None,
            stack: Some(false),
        }),
        prompt: None,
    }
    .call(
        ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
        RequestContext::new(user(VIEWER)),
    )
    .await
    .unwrap();

    assert!(
        response
            .markdown
            .contains(r#""displayMode":"scatter","chart":{"x":"status","y":["guests"]}}"#),
        "{}",
        response.markdown
    );
}

#[tokio::test]
async fn an_unscoped_scalar_question_omits_what_it_does_not_have() {
    let world = world();
    let response = SaveDatabaseQuery {
        database_id: None,
        sql: "SELECT COUNT(*) FROM \"Offsite\".\"Guests\"".to_string(),
        title: "Guests".to_string(),
        display_mode: QueryDatabaseDisplay::Scalar,
        chart: None,
        prompt: Some("How many guests are coming?".to_string()),
    }
    .call(
        ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
        RequestContext::new(user(VIEWER)),
    )
    .await
    .unwrap();

    assert_eq!(
        response.markdown,
        r#"<m-db-query>{"queryId":"00000000-0000-0000-0000-000000000e11","title":"Guests","prompt":"How many guests are coming?","displayMode":"scalar"}</m-db-query>"#
    );
}

#[tokio::test]
async fn a_title_cannot_close_the_block_early() {
    let world = world();
    let response = SaveDatabaseQuery {
        database_id: Some(OFFSITE),
        sql: PARTY_SQL.to_string(),
        title: "a</m-db-query>b".to_string(),
        display_mode: QueryDatabaseDisplay::Table,
        chart: None,
        prompt: None,
    }
    .call(
        ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
        RequestContext::new(user(VIEWER)),
    )
    .await
    .unwrap();

    assert!(
        response
            .markdown
            .contains(r#""title":"a\u003c/m-db-query>b","prompt":"a\u003c/m-db-query>b""#),
        "{}",
        response.markdown
    );
}

#[tokio::test]
async fn a_chart_the_block_cannot_draw_is_refused_before_saving() {
    for (chart, refusal) in [
        (
            ToolChart {
                x: "status".to_string(),
                y: vec!["status".to_string()],
                title: None,
                color: None,
                stack: None,
            },
            "chart.y must not include the label column chart.x.",
        ),
        (
            ToolChart {
                x: "status".to_string(),
                y: vec!["guests".to_string()],
                title: None,
                color: Some("status".to_string()),
                stack: None,
            },
            "chart.color must not be the label column chart.x.",
        ),
        (
            ToolChart {
                x: "status".to_string(),
                y: vec!["guests".to_string()],
                title: None,
                color: Some("guests".to_string()),
                stack: None,
            },
            "chart.color must not be one of the chart.y columns.",
        ),
        (
            ToolChart {
                x: "status".to_string(),
                y: vec!["guests".to_string(), "maybes".to_string()],
                title: None,
                color: Some("party".to_string()),
                stack: None,
            },
            "chart.color splits a single series; with chart.color, chart.y names one column.",
        ),
        (
            ToolChart {
                x: "party".to_string(),
                y: vec!["guests".to_string()],
                title: None,
                color: None,
                stack: None,
            },
            "the chart names \"party\", but the query returns \"status\", \"guests\". Name \
             chart columns as the SELECT names its results, with AS for an aggregate.",
        ),
        (
            ToolChart {
                x: "guests".to_string(),
                y: vec!["status".to_string()],
                title: None,
                color: None,
                stack: None,
            },
            "the chart plots \"status\", which is not a number. Name chart columns as the \
             SELECT names its results, with AS for an aggregate.",
        ),
        (
            ToolChart {
                x: "status".to_string(),
                y: vec!["guests".to_string()],
                title: None,
                color: Some(" ".to_string()),
                stack: None,
            },
            "chart.color must name a result column.",
        ),
    ] {
        let world = world();
        let error = SaveDatabaseQuery {
            database_id: Some(OFFSITE),
            sql: PARTY_SQL.to_string(),
            title: "Guests by status".to_string(),
            display_mode: QueryDatabaseDisplay::Bar,
            chart: Some(chart),
            prompt: None,
        }
        .call(
            ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
            RequestContext::new(user(VIEWER)),
        )
        .await
        .expect_err("the block cannot draw it");
        assert_eq!(error.description, refusal);
        assert!(world.lock().unwrap().saved.is_empty());
    }
}

#[tokio::test]
async fn a_question_that_does_not_compile_reaches_the_model_verbatim() {
    let world = world();
    let error = SaveDatabaseQuery {
        database_id: Some(OFFSITE),
        sql: "SELECT statuz FROM \"Guests\"".to_string(),
        title: "Guests by status".to_string(),
        display_mode: QueryDatabaseDisplay::Table,
        chart: None,
        prompt: None,
    }
    .call(
        ServiceContext(DatabasesSqlToolContext::new(sql(&world))),
        RequestContext::new(user(VIEWER)),
    )
    .await
    .expect_err("a broken question is not saved");

    assert!(
        error.description.contains("statuz"),
        "{}",
        error.description
    );
    assert!(world.lock().unwrap().saved.is_empty());
}

#[test]
fn save_query_teaches_pasting_the_block_and_every_chart() {
    let validated =
        generate_validated_input_schema::<SaveDatabaseQuery>().expect("schema should validate");
    for expected in [
        "markdown",
        "verbatim",
        "displayMode",
        "AS invites",
        "`area`",
        "`scatter`",
        "`color`",
        "`stack`",
    ] {
        assert!(
            validated.description.contains(expected),
            "description is missing {expected}: {}",
            validated.description
        );
    }
}
