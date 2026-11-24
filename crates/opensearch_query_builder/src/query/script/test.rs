use super::*;
use serde_json::json;

#[test]
fn a_script_query_wraps_its_script() {
    let query =
        ScriptQuery::new(Script::new("doc['n'].value > params.min").params(json!({ "min": 3 })));

    assert_eq!(
        QueryType::from(query).to_json(),
        json!({
            "script": {
                "script": {
                    "source": "doc['n'].value > params.min",
                    "lang": "painless",
                    "params": { "min": 3 }
                }
            }
        })
    );
}
