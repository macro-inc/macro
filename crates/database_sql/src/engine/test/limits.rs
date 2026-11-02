use super::*;

fn finish(sql: &str) {
    assert!(sql.len() < models_databases::MAX_STATEMENT_LENGTH);
    let (mut engine, step) = Engine::start(&catalog(), sql).expect("a supported long query");
    serde_json::to_string(&step).expect("the request crosses the wire");
    let Step::Fetch(request) = step else {
        panic!("expected a row fetch");
    };
    let result = engine
        .feed_page(
            request.id,
            Page {
                rows: vec![],
                next: None,
            },
        )
        .expect("the query finishes");
    assert!(matches!(result, Step::Done(_)));
}

#[test]
fn long_flat_and_conditions_complete() {
    for condition in ["amount = 1", "stage = 'Won'"] {
        finish(&format!(
            "SELECT * FROM crm.deals WHERE {}",
            vec![condition; 10_000].join(" AND ")
        ));
    }
}

#[test]
fn long_flat_or_conditions_complete() {
    for condition in ["amount = 1", "stage = 'Won'"] {
        finish(&format!(
            "SELECT * FROM crm.deals WHERE {}",
            vec![condition; 10_000].join(" OR ")
        ));
    }
}

#[test]
fn long_in_lists_complete() {
    for (column, value) in [("amount", "1"), ("stage", "'Won'")] {
        finish(&format!(
            "SELECT * FROM crm.deals WHERE {column} IN ({})",
            vec![value; 10_000].join(",")
        ));
    }
}
