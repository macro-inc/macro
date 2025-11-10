use super::*;
#[test]
fn test_file_types() {
    let query_key = "match_phrase";
    let file_types = vec!["pdf".to_string(), "docx".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let terms = vec!["test".to_string()];
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": Vec::<String>::new()
                        }
                    },
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    query_key: {
                                        "content": terms[0]
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "terms": {
                            "file_type": file_types
                        }
                    }
                ],
            }
        },
        "from": from,
        "size": page_size,
        "sort":  [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "document_id": {
                    "order": "asc"
                }
            },
            {
                "node_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified", // The way the highlight is done
                    "number_of_fragments": 500, // Breaks up the "content" field into said
                    "pre_tags": ["<macro_em>"], // HTML tag before highlight
                    "post_tags": ["</macro_em>"], // HTML tag after highlight
                }
            },
            "require_field_match": true, // Default is true, but good to be explicit
        },
    });

    let generated = DocumentQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .file_types(file_types)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_sanity() {
    let query_key = "match_phrase";
    let document_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let terms = vec!["test".to_string()];
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    query_key: {
                                        "content": terms[0]
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "from": from,
        "size": page_size,
        "sort":  [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "document_id": {
                    "order": "asc"
                }
            },
            {
                "node_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified", // The way the highlight is done
                    "number_of_fragments": 500, // Breaks up the "content" field into said
                    "pre_tags": ["<macro_em>"], // HTML tag before highlight
                    "post_tags": ["</macro_em>"], // HTML tag after highlight
                }
            },
            "require_field_match": true, // Default is true, but good to be explicit
        },
    });

    let generated = DocumentQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(document_ids)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_ids_only() {
    let query_key = "match_phrase";
    let document_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let terms = vec!["test".to_string()];
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    query_key: {
                                        "content": terms[0]
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "from": from,
        "size": page_size,
        "sort":  [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "document_id": {
                    "order": "asc"
                }
            },
            {
                "node_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified", // The way the highlight is done
                    "number_of_fragments": 500, // Breaks up the "content" field into said
                    "pre_tags": ["<macro_em>"], // HTML tag before highlight
                    "post_tags": ["</macro_em>"], // HTML tag after highlight
                }
            },
            "require_field_match": true, // Default is true, but good to be explicit
        },
    });

    let generated = DocumentQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(document_ids)
        .ids_only(true)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_name_search() {
    let query_key = "match_phrase";
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let terms = vec!["test".to_string()];
    let document_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let reference = serde_json::json!({
        "collapse": {
            "field": "document_id"
        },
        "from": from,
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified", // The way the highlight is done
                    "number_of_fragments": 500, // Breaks up the "content" field into said
                    "pre_tags": ["<macro_em>"], // HTML tag before highlight
                    "post_tags": ["</macro_em>"], // HTML tag after highlight
                }
            },
            "require_field_match": true, // Default is true, but good to be explicit
        },
        "query": {

            "bool": {
                "should": [
                    {
                        "term": {
                            "owner_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "document_id": document_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    query_key: {
                                        "document_name": terms[0]
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "size": page_size,
        "sort":  [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "document_id": {
                    "order": "asc"
                }
            },
            {
                "node_id": {
                    "order": "asc"
                }
            },
        ],
    });

    let generated = DocumentQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(document_ids)
        .search_on(SearchOn::Name)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}
