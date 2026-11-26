use super::*;

#[test]
fn the_report_line_is_read_for_its_own_nonce() {
    let nonce = Uuid::now_v7();
    let text = format!("Done.\nCONNECTORS-E2E {nonce} tools=12 called=`list_teams` ok=true\n");
    assert_eq!(
        parse_report(&text, nonce),
        Some((12, "list_teams".to_owned(), true))
    );
}

#[test]
fn a_report_under_another_nonce_is_not_this_runs() {
    let text = format!(
        "CONNECTORS-E2E {} tools=3 called=search ok=true",
        Uuid::now_v7()
    );
    assert_eq!(parse_report(&text, Uuid::now_v7()), None);
}

#[test]
fn a_failed_call_is_reported_as_such() {
    let nonce = Uuid::now_v7();
    let text = format!("CONNECTORS-E2E {nonce} tools=0 called=none ok=false");
    assert_eq!(
        parse_report(&text, nonce),
        Some((0, "none".to_owned(), false))
    );
}

#[test]
fn the_prompts_template_is_not_a_report() {
    let nonce = Uuid::now_v7();
    assert_eq!(parse_report(&prompt("Linear", nonce), nonce), None);
}
