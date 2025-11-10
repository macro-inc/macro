use super::*;
#[test]
fn test_sanity() {
    let query_key = "match_phrase";
    let chat_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                            "user_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "chat_id": chat_ids
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
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
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

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(chat_ids)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_build_with_single_role() {
    let query = "test";
    let user_id = "user1";
    let role = vec!["user".to_string()];
    let page_size = 10;
    let page = 0;

    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "user_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "chat_id": []
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "role": {
                                            "value": "*user*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    }
                ],
            }
        },
        "from": 0,
        "size": page_size,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            },
            "require_field_match": true,
        },
    });

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .role(role)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_build_with_multiple_roles() {
    let query = "test";
    let user_id = "user1";
    let roles = vec!["user".to_string(), "assistant".to_string()];
    let page_size = 10;
    let page = 0;

    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "user_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "chat_id": []
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "role": {
                                            "value": "*user*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "role": {
                                            "value": "*assistant*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    }
                ],
            }
        },
        "from": 0,
        "size": page_size,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            },
            "require_field_match": true,
        },
    });

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .role(roles)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_build_with_role_and_chat_ids() {
    let query = "test";
    let user_id = "user1";
    let chat_ids = vec!["chat1".to_string(), "chat2".to_string()];
    let roles = vec!["user".to_string()];
    let page_size = 5;
    let page = 1;
    let from = page * page_size;

    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "user_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "chat_id": chat_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "role": {
                                            "value": "*user*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    }
                ],
            }
        },
        "from": from,
        "size": page_size,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            },
            "require_field_match": true,
        },
    });

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(chat_ids)
        .role(roles)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_build_with_empty_role_filter() {
    let query = "test";
    let user_id = "user1";
    let empty_roles = vec![];
    let page_size = 10;
    let page = 0;

    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "term": {
                            "user_id": user_id
                        }
                    },
                    {
                        "terms": {
                            "chat_id": []
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": query
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    }
                ],
            }
        },
        "from": 0,
        "size": page_size,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            },
        ],
        "highlight": {
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            },
            "require_field_match": true,
        },
    });

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .role(empty_roles)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_ids_only() {
    let query_key = "match_phrase";
    let chat_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                            "chat_id": chat_ids
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
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
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

    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(chat_ids)
        .ids_only(true)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_build_with_role_and_search_on_name() {
    let query = "test";
    let user_id = "user1";
    let roles = vec!["user".to_string()];
    let page_size = 10;
    let page = 0;

    let reference = serde_json::json!({
        "collapse": {
            "field": "chat_id"
        },
        "from": 0,
        "highlight": {
            "fields": {
                "content": {
                    "number_of_fragments": 500,
                    "post_tags": ["</macro_em>"],
                    "pre_tags": ["<macro_em>"],
                    "type": "unified"
                }
            },
            "require_field_match": true,
        },
        "query": {
            "bool": {
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "match_phrase": {
                                        "title": query
                                    }
                                }
                            ]
                        }
                    },
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "role": {
                                            "case_insensitive": true,
                                            "value": "*user*"
                                        }
                                    }
                                }
                            ]
                        }
                    }
                ],
                "should": [
                    {
                        "term": {
                            "user_id": "user1"
                        }
                    },
                    {
                        "terms": {
                            "chat_id": []
                        }
                    }
                ]
            }
        },
        "size": 10,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "chat_id": {
                    "order": "asc"
                }
            },
            {
                "chat_message_id": {
                    "order": "asc"
                }
            }
        ]
    });
    let generated = ChatQueryBuilder::new(vec![query.to_string()])
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .role(roles)
        .search_on(SearchOn::Name)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}
