use std::collections::BTreeMap;

use super::*;

struct Known(BTreeMap<&'static str, &'static str>);

impl Contexts for Known {
    fn lookup(&self, path: &[String]) -> Result<Value, Report> {
        if path[0] == "secrets" {
            bail!("no secrets here");
        }
        Ok(self
            .0
            .get(path.join(".").as_str())
            .map_or(Value::Null, |value| Value::String((*value).to_owned())))
    }
}

fn known() -> Known {
    Known(BTreeMap::from([
        ("needs.path-check.outputs.should_run", "true"),
        ("needs.path-check.outputs.query_data", "false"),
        ("needs.path-check.outputs.rust_packages", "email documents"),
        ("steps.bans.outcome", "success"),
        ("matrix.shard", "3"),
        ("env.RUST_PACKAGES", "all"),
    ]))
}

fn truthy(source: &str) -> bool {
    evaluate(source, &known()).expect("evaluates").truthy()
}

#[test]
fn compares_outputs_the_way_job_conditions_do() {
    assert!(truthy("needs.path-check.outputs.should_run == 'true'"));
    assert!(!truthy(
        "needs.path-check.outputs.should_run == 'true' && needs.path-check.outputs.query_data == 'true'"
    ));
    assert!(truthy(
        "needs.path-check.outputs.should_run == 'true' && (needs.path-check.outputs.rust_packages == 'all' || contains(needs.path-check.outputs.rust_packages, 'email'))"
    ));
    assert!(truthy("!cancelled() && steps.bans.outcome != 'skipped'"));
    assert!(truthy("${{ env.RUST_PACKAGES == 'all' }}"));
}

#[test]
fn an_output_nobody_set_is_empty() {
    assert!(!truthy("needs.path-check.outputs.missing == 'true'"));
    assert!(truthy("needs.path-check.outputs.missing == ''"));
    assert!(truthy("needs.path-check.outputs.missing != 'true'"));
}

#[test]
fn and_or_choose_an_operand() {
    let value = evaluate(
        "needs.path-check.outputs.query_data == 'true' && 'the pull request changes query data' || ''",
        &known(),
    )
    .expect("evaluates");
    assert_eq!(value, Value::String(String::new()));

    let value = evaluate(
        "needs.path-check.outputs.should_run == 'true' && 'yes' || 'no'",
        &known(),
    )
    .expect("evaluates");
    assert_eq!(value, Value::String("yes".to_owned()));
}

#[test]
fn renders_expressions_inside_text() {
    assert_eq!(
        render("bun run test --shard=${{ matrix.shard }}/6", &known()).expect("renders"),
        "bun run test --shard=3/6"
    );
    assert_eq!(
        render("${{ needs.path-check.outputs.rust_packages }}", &known()).expect("renders"),
        "email documents"
    );
    assert_eq!(
        render("no expression", &known()).expect("renders"),
        "no expression"
    );
}

#[test]
fn strings_escape_a_quote_by_doubling_it() {
    let value = evaluate("'it''s'", &known()).expect("evaluates");
    assert_eq!(value, Value::String("it's".to_owned()));
}

#[test]
fn refuses_what_it_does_not_know() {
    assert!(evaluate("secrets.DOPPLER_TOKEN != ''", &known()).is_err());
    assert!(evaluate("hashFiles('Cargo.lock')", &known()).is_err());
    assert!(evaluate("fromJSON(env.RUST_PACKAGES)", &known()).is_err());
    assert!(evaluate("matrix.shard >= 2", &known()).is_err());
    assert!(render("echo ${{ matrix.shard", &known()).is_err());
}
