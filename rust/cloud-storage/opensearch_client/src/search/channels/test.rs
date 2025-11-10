use super::*;
#[test]
fn test_with_additional_fields() {
    let query_key = "match_phrase";
    let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "test";
    let thread_ids = vec!["T1".to_string(), "T2".to_string()];
    let mentions = vec!["M1".to_string(), "M2".to_string()];
    let org_id = 1;
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "sender_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "term": {
                            "org_id": org_id
                        }
                    },
                    {
                        "terms": {
                            "thread_id": thread_ids
                        }
                    },
                    {
                        "terms": {
                            "mentions": mentions
                        }
                    },
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                "channel_id": {
                    "order": "asc"
                }
            },
            {
                "message_id": {
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

    let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
        .mentions(mentions)
        .thread_ids(thread_ids)
        .org_id(org_id)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(channel_ids)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_sanity() {
    let query_key = "match_phrase";
    let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "test";
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "sender_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                "channel_id": {
                    "order": "asc"
                }
            },
            {
                "message_id": {
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

    let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(channel_ids)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_ids_only() {
    let query_key = "match_phrase";
    let channel_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "test";
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "terms": {
                            "channel_id": channel_ids
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
                "channel_id": {
                    "order": "asc"
                }
            },
            {
                "message_id": {
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

    let generated = ChannelMessageQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(channel_ids)
        .ids_only(true)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_sender_ids() {
    let channel_ids = vec!["CH1".to_string(), "CH2".to_string()];
    let user_id = "user123";
    let terms = vec!["search".to_string()];
    let sender_ids: Vec<String> = vec!["paul", "ringo", "john", "george"]
        .into_iter()
        .map(String::from)
        .collect();

    let (_, builder) = ChannelMessageQueryBuilder::new(terms)
        .match_type("exact")
        .page(0)
        .page_size(10)
        .user_id(user_id)
        .ids(channel_ids.clone())
        .sender_ids(sender_ids.clone())
        .query_builder()
        .unwrap();

    let must = if let QueryType::Bool(bool) = builder.build().into() {
        bool.must
    } else {
        panic!("Could not extract MUST field from bool because type was not a bool");
    };

    // Check that sender_ids are in the must field as a terms query
    let sender_ids_constraint_found = must.iter().any(|item| {
        if let QueryType::Terms(terms_query) = item {
            // Check if this is a terms query for "sender_id" field with all expected values
            terms_query.field == "sender_id"
                && terms_query.values.len() == sender_ids.len()
                && sender_ids
                    .iter()
                    .all(|id| terms_query.values.iter().any(|v| v.as_str() == Some(id)))
        } else {
            false
        }
    });

    assert!(
        sender_ids_constraint_found,
        "sender_ids should be present in must clause as terms query for sender_id field"
    );

    // Also verify that we have the expected number of must clauses
    // Should include: search terms, channel_id (from channel_search=true), and sender_id
    assert!(
        must.len() >= 3,
        "Must clause should contain at least 3 items: search terms, channel_id, and sender_id"
    );
}
