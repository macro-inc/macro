use super::*;

use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_unified_search_request_content() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::Content,
        collapse: true,
        ids_only: false,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
        },
    };

    let result = build_unified_search_request(unified_search_args)?;

    let expected = serde_json::json!({
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
          "content": {
            "number_of_fragments": 500,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          }
        },
        "require_field_match": true
      },
      "query": {
        "bool": {
          "minimum_should_match": 1,
          "should": [
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "documents"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "owner_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "terms": {
                      "link_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "emails"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "terms": {
                      "thread_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "mentions": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "sender_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "channels"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "sender_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
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
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "chats"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "projects"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_name() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::Name,
        collapse: true,
        ids_only: false,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
        },
    };

    let result = build_unified_search_request(unified_search_args)?;

    let expected = serde_json::json!({
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
            "document_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "subject": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "title": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "channel_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            },
            "project_name": {
                "number_of_fragments": 1,
                "post_tags": [
                    "</macro_em>"
                ],
                "pre_tags": [
                    "<macro_em>"
                ],
                "type": "plain"
            }
        },
        "require_field_match": true
      },
      "query": {
        "bool": {
          "minimum_should_match": 1,
          "should": [
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "document_name": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "documents"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "owner_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "subject": "test"
                    }
                  },
                  {
                    "terms": {
                      "link_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "bool": {
                      "minimum_should_match": 1,
                      "should": [
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "sender": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "cc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "bcc": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
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
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "recipients": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "emails"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "channel_name": "test"
                    }
                  },
                  {
                    "terms": {
                      "thread_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "mentions": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "terms": {
                      "sender_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "channels"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "sender_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "title": "test"
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
                              "value": "*id1*"
                            }
                          }
                        },
                        {
                          "wildcard": {
                            "role": {
                              "case_insensitive": true,
                              "value": "*id2*"
                            }
                          }
                        }
                      ]
                    }
                  },
                  {
                    "term": {
                      "_index": "chats"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            },
            {
              "bool": {
                "minimum_should_match": 1,
                "must": [
                  {
                    "match_phrase": {
                      "project_name": "test"
                    }
                  },
                  {
                    "term": {
                      "_index": "projects"
                    }
                  }
                ],
                "should": [
                  {
                    "terms": {
                      "entity_id": [
                        "id1",
                        "id2"
                      ]
                    }
                  },
                  {
                    "term": {
                      "user_id": "user"
                    }
                  }
                ]
              }
            }
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_unified_search_request_name_content() -> anyhow::Result<()> {
    let unified_search_args = UnifiedSearchArgs {
        terms: vec!["test".to_string()],
        user_id: "user".to_string(),
        page: 1,
        page_size: 20,
        match_type: "exact".to_string(),
        search_on: SearchOn::NameContent,
        collapse: true,
        ids_only: false,
        disable_recency: false,
        document_search_args: UnifiedDocumentSearchArgs {
            document_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        email_search_args: UnifiedEmailSearchArgs {
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            link_ids: vec!["id1".to_string(), "id2".to_string()],
            sender: vec!["id1".to_string(), "id2".to_string()],
            cc: vec!["id1".to_string(), "id2".to_string()],
            bcc: vec!["id1".to_string(), "id2".to_string()],
            recipients: vec!["id1".to_string(), "id2".to_string()],
        },
        channel_message_search_args: UnifiedChannelMessageSearchArgs {
            channel_ids: vec!["id1".to_string(), "id2".to_string()],
            thread_ids: vec!["id1".to_string(), "id2".to_string()],
            mentions: vec!["id1".to_string(), "id2".to_string()],
            sender_ids: vec!["id1".to_string(), "id2".to_string()],
        },
        chat_search_args: UnifiedChatSearchArgs {
            chat_ids: vec!["id1".to_string(), "id2".to_string()],
            role: vec!["id1".to_string(), "id2".to_string()],
        },
        project_search_args: UnifiedProjectSearchArgs {
            project_ids: vec!["id1".to_string(), "id2".to_string()],
        },
    };

    let result = build_unified_search_request(unified_search_args)?;

    let expected = serde_json::json!(
    {
      "aggs": {
        "total_uniques": {
          "cardinality": {
            "field": "entity_id"
          }
        }
      },
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": {
        "fields": {
          "channel_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "content": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "document_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "project_name": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "subject": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          },
          "title": {
            "number_of_fragments": 1,
            "post_tags": [
              "</macro_em>"
            ],
            "pre_tags": [
              "<macro_em>"
            ],
            "type": "plain"
          }
        },
        "require_field_match": false
      },
      "query": {
        "function_score": {
          "boost_mode": "multiply",
          "functions": [
            {
              "gauss": {
                "updated_at_seconds": {
                  "decay": 0.5,
                  "offset": "3d",
                  "origin": "now",
                  "scale": "21d"
                }
              },
              "weight": 1.3
            }
          ],
          "query": {
            "bool": {
              "minimum_should_match": 1,
              "should": [
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "document_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "document_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "documents"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "owner_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "subject": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "subject": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "terms": {
                          "link_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "wildcard": {
                                "sender": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "sender": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
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
                                "cc": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "cc": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
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
                                "bcc": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "bcc": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
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
                                "recipients": {
                                  "case_insensitive": true,
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "recipients": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "emails"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "channel_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "channel_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "terms": {
                          "thread_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "terms": {
                          "mentions": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "terms": {
                          "sender_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "channels"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "sender_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "title": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "title": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
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
                                  "value": "*id1*"
                                }
                              }
                            },
                            {
                              "wildcard": {
                                "role": {
                                  "case_insensitive": true,
                                  "value": "*id2*"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "chats"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                },
                {
                  "bool": {
                    "minimum_should_match": 1,
                    "must": [
                      {
                        "bool": {
                          "minimum_should_match": 1,
                          "should": [
                            {
                              "match_phrase_prefix": {
                                "project_name": {
                                  "boost": 1000.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match_phrase_prefix": {
                                "content": {
                                  "boost": 900.0,
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "project_name": {
                                  "boost": 0.1,
                                  "minimum_should_match": "80%",
                                  "query": "test"
                                }
                              }
                            },
                            {
                              "match": {
                                "content": {
                                  "boost": 0.09,
                                  "minimum_should_match": "1",
                                  "query": "test"
                                }
                              }
                            }
                          ]
                        }
                      },
                      {
                        "term": {
                          "_index": "projects"
                        }
                      }
                    ],
                    "should": [
                      {
                        "terms": {
                          "entity_id": [
                            "id1",
                            "id2"
                          ]
                        }
                      },
                      {
                        "term": {
                          "user_id": "user"
                        }
                      }
                    ]
                  }
                }
              ]
            }
          },
          "score_mode": "multiply"
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        }
      ],
      "track_total_hits": true
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
