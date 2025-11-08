use super::*;

#[test]
fn test_email_query_with_thread_ids() {
    let query_key = "match_phrase";
    let message_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let thread_ids = vec!["thread1".to_string(), "thread2".to_string()];
    let link_ids = vec!["link1".to_string(), "link2".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "test";
    let terms = vec![query.to_string()];

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
                            "message_id": message_ids
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
                                        "content": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "terms": {
                            "thread_id": thread_ids
                        }
                    },
                    {
                        "terms": {
                            "link_id": link_ids
                        }
                    },
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(message_ids)
        .thread_ids(thread_ids)
        .link_ids(link_ids)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    let s1 = serde_json::to_string_pretty(&generated).unwrap();
    let s2 = serde_json::to_string_pretty(&reference).unwrap();

    println!("{}", s1);
    println!("{}", s2);

    assert_eq!(&generated, &reference);
}

#[test]
fn test_email_query_with_senders() {
    let query_key = "match_phrase";
    let senders = vec!["sender1".to_string(), "seNdeR2".to_string()];
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
                            "message_id": Vec::<String>::new()
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
                                        "content": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "sender": {
                                            "value": "*sender1*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "sender": {
                                            "value": "*sender2*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .sender(senders)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_email_query_with_cc() {
    let query_key = "match_phrase";
    let cc = vec!["cc1".to_string(), "cC2".to_string()];
    let bcc = vec!["bcc1".to_string(), "bCc2".to_string()];
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
                            "message_id": Vec::<String>::new()
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
                                        "content": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "cc": {
                                            "value": "*cc1*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "cc": {
                                            "value": "*cc2*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "bcc": {
                                            "value": "*bcc1*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "bcc": {
                                            "value": "*bcc2*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .cc(cc)
        .bcc(bcc)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_email_query_with_recipients() {
    let query_key = "match_phrase";
    let recipients = vec!["recipient1".to_string(), "recipient2".to_string()];
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
                            "message_id": Vec::<String>::new()
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
                                        "content": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "recipients": {
                                            "value": "*recipient1*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "recipients": {
                                            "value": "*recipient2*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .recipients(recipients)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_ids_only() {
    let query_key = "match_phrase";
    let message_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
    let user_id = "user";
    let page = 1;
    let page_size = 2;
    let from = page * page_size;
    let query = "test";
    let terms = vec![query.to_string()];
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "terms": {
                            "message_id": message_ids
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
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(message_ids)
        .ids_only(true)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_sanity() {
    let query_key = "match_phrase";
    let message_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                            "message_id": message_ids
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
                                }
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
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(message_ids)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}
#[test]
fn test_email_name_only_search() {
    let query_key = "match_phrase";
    let message_ids = vec!["A".to_string(), "B".to_string(), "C".to_string()];
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
                            "message_id": message_ids
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
                                        "subject": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "from": from,
        "size": page_size,
        "collapse": {
            "field": "message_id"
        },
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(message_ids)
        .search_on(SearchOn::Name)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}

#[test]
fn test_email_name_only_with_senders() {
    let query_key = "match_phrase";
    let senders = vec!["sender1".to_string(), "seNdeR2".to_string()];
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
                            "message_id": Vec::<String>::new()
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
                                        "subject": query
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                    {
                        "bool": {
                            "should": [
                                {
                                    "wildcard": {
                                        "sender": {
                                            "value": "*sender1*",
                                            "case_insensitive": true
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "sender": {
                                            "value": "*sender2*",
                                            "case_insensitive": true
                                        }
                                    }
                                }
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "from": from,
        "size": page_size,
        "collapse": {
            "field": "message_id"
        },
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "message_id": {
                    "order": "asc"
                }
            },
            {
                "thread_id": {
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
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = EmailQueryBuilder::new(vec![query.to_string()])
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .sender(senders)
        .search_on(SearchOn::Name)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}
