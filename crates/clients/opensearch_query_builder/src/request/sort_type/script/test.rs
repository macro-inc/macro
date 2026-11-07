use super::*;
use crate::ToOpenSearchJson;

#[test]
fn test_script_sort_basic_number() {
    // Basic script sort with number type
    let script = Script {
        source: "doc['field_name'].value * params.factor".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Desc,
        mode: None,
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['field_name'].value * params.factor",
                    "lang": "painless"
                },
                "order": "desc"
            }
        })
    );
}

#[test]
fn test_script_sort_with_params() {
    // Script sort with parameters
    let script = Script {
        source: "doc['field_name'].value * params.factor".into(),
        lang: Lang::Painless,
        params: Some(serde_json::json!({"factor": 1.5})),
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Asc,
        mode: None,
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['field_name'].value * params.factor",
                    "lang": "painless",
                    "params": {
                        "factor": 1.5
                    }
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_sort_string_type() {
    // Script sort with string type
    let script = Script {
        source: "doc['last_name'].value + ', ' + doc['first_name'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::String,
        script,
        order: SortOrder::Asc,
        mode: None,
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "string",
                "script": {
                    "source": "doc['last_name'].value + ', ' + doc['first_name'].value",
                    "lang": "painless"
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_sort_version_type() {
    // Script sort with version type
    let script = Script {
        source: "doc['version'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Version,
        script,
        order: SortOrder::Desc,
        mode: None,
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "version",
                "script": {
                    "source": "doc['version'].value",
                    "lang": "painless"
                },
                "order": "desc"
            }
        })
    );
}

#[test]
fn test_script_sort_with_mode_min() {
    // Script sort with mode set to minimum
    let script = Script {
        source: "doc['ratings'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Asc,
        mode: Some(SortMode::Min),
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['ratings'].value",
                    "lang": "painless"
                },
                "order": "asc",
                "mode": "min"
            }
        })
    );
}

#[test]
fn test_script_sort_with_mode_max() {
    // Script sort with mode set to maximum
    let script = Script {
        source: "doc['scores'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Desc,
        mode: Some(SortMode::Max),
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['scores'].value",
                    "lang": "painless"
                },
                "order": "desc",
                "mode": "max"
            }
        })
    );
}

#[test]
fn test_script_sort_with_mode_avg() {
    // Script sort with mode set to average
    let script = Script {
        source: "doc['values'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Asc,
        mode: Some(SortMode::Avg),
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['values'].value",
                    "lang": "painless"
                },
                "order": "asc",
                "mode": "avg"
            }
        })
    );
}

#[test]
fn test_script_sort_with_expression_lang() {
    // Script sort using expression language
    let script = Script {
        source: "doc['price'].value * 1.2".into(),
        lang: Lang::Expression,
        params: None,
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Asc,
        mode: None,
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['price'].value * 1.2",
                    "lang": "expression"
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_sort_complex_with_all_options() {
    // Complex script sort with all options set
    let script = Script {
        source: "Math.log(doc['value'].value) * params.multiplier".into(),
        lang: Lang::Painless,
        params: Some(serde_json::json!({
            "multiplier": 2.5,
            "offset": 10
        })),
    };
    let sort = ScriptSort {
        sort_type: ScriptSortType::Number,
        script,
        order: SortOrder::Desc,
        mode: Some(SortMode::Sum),
    };

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "Math.log(doc['value'].value) * params.multiplier",
                    "lang": "painless",
                    "params": {
                        "multiplier": 2.5,
                        "offset": 10
                    }
                },
                "order": "desc",
                "mode": "sum"
            }
        })
    );
}

#[test]
fn test_script_sort_with_cow_str() {
    // Test that Cow<str> works correctly with both borrowed and owned strings
    let borrowed_script = Script {
        source: "doc['field'].value".into(),
        lang: Lang::Painless,
        params: None,
    };
    let owned_script = Script {
        source: "doc['field'].value".to_string().into(),
        lang: Lang::Painless,
        params: None,
    };

    let sort1 = ScriptSort {
        sort_type: ScriptSortType::Number,
        script: borrowed_script,
        order: SortOrder::Asc,
        mode: None,
    };

    let sort2 = ScriptSort {
        sort_type: ScriptSortType::Number,
        script: owned_script,
        order: SortOrder::Asc,
        mode: None,
    };

    let result1 = sort1.to_json();
    let result2 = sort2.to_json();

    assert_eq!(result1, result2);
    assert_eq!(
        result1,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['field'].value",
                    "lang": "painless"
                },
                "order": "asc"
            }
        })
    );
}

// Builder pattern tests

#[test]
fn test_script_builder_basic() {
    // Test basic Script::new() builder
    let script = Script::new("doc['field'].value");

    assert_eq!(script.source, "doc['field'].value");
    assert!(matches!(script.lang, Lang::Painless));
    assert!(script.params.is_none());
}

#[test]
fn test_script_builder_with_lang() {
    // Test Script builder with lang
    let script = Script::new("doc['price'].value * 1.2").lang(Lang::Expression);

    let sort = ScriptSort::new(script, ScriptSortType::Number, SortOrder::Asc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['price'].value * 1.2",
                    "lang": "expression"
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_builder_with_params() {
    // Test Script builder with params
    let script = Script::new("doc['field'].value * params.factor")
        .params(serde_json::json!({"factor": 1.5}));

    let sort = ScriptSort::new(script, ScriptSortType::Number, SortOrder::Desc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['field'].value * params.factor",
                    "lang": "painless",
                    "params": {
                        "factor": 1.5
                    }
                },
                "order": "desc"
            }
        })
    );
}

#[test]
fn test_script_builder_chained() {
    // Test Script builder with all methods chained
    let script = Script::new("doc['value'].value * params.multiplier")
        .lang(Lang::Painless)
        .params(serde_json::json!({
            "multiplier": 2.0,
            "threshold": 100
        }));

    let sort = ScriptSort::new(script, ScriptSortType::Number, SortOrder::Asc);
    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['value'].value * params.multiplier",
                    "lang": "painless",
                    "params": {
                        "multiplier": 2.0,
                        "threshold": 100
                    }
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_basic() {
    // Test basic ScriptSort::new() builder
    let script = Script::new("doc['ratings'].value");
    let sort = ScriptSort::new(script, ScriptSortType::Number, SortOrder::Desc);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['ratings'].value",
                    "lang": "painless"
                },
                "order": "desc"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_with_mode() {
    // Test ScriptSort builder with mode
    let script = Script::new("doc['scores'].value");
    let sort = ScriptSort::new(script, ScriptSortType::Number, SortOrder::Asc).mode(SortMode::Avg);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['scores'].value",
                    "lang": "painless"
                },
                "order": "asc",
                "mode": "avg"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_string_type() {
    // Test ScriptSort builder with string type
    let script = Script::new("doc['last_name'].value + ', ' + doc['first_name'].value");
    let sort = ScriptSort::new(script, ScriptSortType::String, SortOrder::Asc);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "string",
                "script": {
                    "source": "doc['last_name'].value + ', ' + doc['first_name'].value",
                    "lang": "painless"
                },
                "order": "asc"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_version_type() {
    // Test ScriptSort builder with version type
    let script = Script::new("doc['version'].value");
    let sort = ScriptSort::new(script, ScriptSortType::Version, SortOrder::Desc);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "version",
                "script": {
                    "source": "doc['version'].value",
                    "lang": "painless"
                },
                "order": "desc"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_fully_chained() {
    // Test fully chained builder pattern
    let sort = ScriptSort::new(
        Script::new("Math.log(doc['value'].value) * params.multiplier")
            .lang(Lang::Painless)
            .params(serde_json::json!({
                "multiplier": 2.5,
                "offset": 10
            })),
        ScriptSortType::Number,
        SortOrder::Desc,
    )
    .mode(SortMode::Sum);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "Math.log(doc['value'].value) * params.multiplier",
                    "lang": "painless",
                    "params": {
                        "multiplier": 2.5,
                        "offset": 10
                    }
                },
                "order": "desc",
                "mode": "sum"
            }
        })
    );
}

#[test]
fn test_script_sort_builder_with_expression_and_mode() {
    // Test builder with expression language and mode
    let sort = ScriptSort::new(
        Script::new("doc['price'].value * 1.19").lang(Lang::Expression),
        ScriptSortType::Number,
        SortOrder::Asc,
    )
    .mode(SortMode::Max);

    let result = sort.to_json();

    assert_eq!(
        result,
        serde_json::json!({
            "_script": {
                "type": "number",
                "script": {
                    "source": "doc['price'].value * 1.19",
                    "lang": "expression"
                },
                "order": "asc",
                "mode": "max"
            }
        })
    );
}
