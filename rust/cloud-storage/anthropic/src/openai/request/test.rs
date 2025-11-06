use crate::types::request::*;
use async_openai::types::CreateChatCompletionRequest;

fn failed_tool_calls() -> CreateChatCompletionRequest {
    let request = r#"
            {
              "messages": [
                {
                  "role": "system",
                  "content": [
                    {
                      "type": "text",
                      "text": "<system_prompt>"
                    }
                  ]
                },
                {
                  "role": "user",
                  "content": "greetings clanker. list my documents"
                },
                {
                  "role": "assistant",
                  "tool_calls": [
                    {
                      "id": "toolu_019UNdEieCsVUEiHXaKgooMM",
                      "type": "function",
                      "function": {
                        "name": "ListDocuments",
                        "arguments": "{\"exhaustiveSearch\":true,\"fileTypes\":[],\"minAccessLevel\":null,\"pageOffset\":0,\"pageSize\":100}"
                      }
                    }
                  ]
                },
                {
                  "role": "tool",
                  "content": "failed to list documents: HTTP 400 Bad Request: Invalid URL: missing field `document_id`",
                  "tool_call_id": "toolu_019UNdEieCsVUEiHXaKgooMM"
                },
                {
                  "role": "assistant",
                  "content": "Let me try that again with the proper parameters:",
                  "tool_calls": [
                    {
                      "id": "toolu_013zTT5ZpforGBtoi3bn2C74",
                      "type": "function",
                      "function": {
                        "name": "ListDocuments",
                        "arguments": "{\"exhaustiveSearch\":true,\"fileTypes\":[],\"minAccessLevel\":\"view\",\"pageOffset\":0,\"pageSize\":100}"
                      }
                    }
                  ]
                },
                {
                  "role": "tool",
                  "content": "failed to list documents: HTTP 400 Bad Request: Invalid URL: missing field `document_id`",
                  "tool_call_id": "toolu_013zTT5ZpforGBtoi3bn2C74"
                }
              ],
              "model": "claude-haiku-4-5",
              "reasoning_effort": "medium",
              "stream": true,
              "stream_options": {
                "include_usage": true
              },
              "tools": [
                {
                  "type": "function",
                  "function": {
                    "name": "ListDocuments",
                    "description": "List documents the user has access to with optional filtering and pagination. Only applies to documents, not emails, AI conversations, chat/slack threads, projects aka folders. This tool returns document metadata including access levels and supports filtering by file type, minimum access level, and pagination. Use this tool to discover and browse documents before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.",
                    "parameters": {
                      "additionalProperties": false,
                      "description": "List documents the user has access to with optional filtering and pagination. Only applies to documents, not emails, AI conversations, chat/slack threads, projects aka folders. This tool returns document metadata including access levels and supports filtering by file type, minimum access level, and pagination. Use this tool to discover and browse documents before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.",
                      "properties": {
                        "exhaustiveSearch": {
                          "additionalProperties": false,
                          "default": false,
                          "description": "Exhaustive search to get all results. Defaults to false. Set to true when you need all matching documents, ignoring pagination limits.",
                          "type": "boolean"
                        },
                        "fileTypes": {
                          "additionalProperties": false,
                          "description": "Document file types to include. Examples: ['pdf'], ['md', 'txt']. Leave empty to include all document types.",
                          "items": {
                            "additionalProperties": false,
                            "type": "string"
                          },
                          "type": [
                            "array",
                            "null"
                          ]
                        },
                        "minAccessLevel": {
                          "additionalProperties": false,
                          "description": "Minimum access level required. Defaults to 'view' if not specified.",
                          "enum": [
                            "view",
                            "comment",
                            "edit",
                            "owner",
                            null
                          ],
                          "type": [
                            "string",
                            "null"
                          ]
                        },
                        "pageOffset": {
                          "additionalProperties": false,
                          "default": 0,
                          "description": "Page offset for pagination. Default is 0. Use higher values to get subsequent pages of results.",
                          "format": "int64",
                          "type": "integer"
                        },
                        "pageSize": {
                          "additionalProperties": false,
                          "default": 50,
                          "description": "Number of results per page. Max is 100, default is 50. Use smaller values for focused results.",
                          "format": "int64",
                          "type": "integer"
                        }
                      },
                      "required": [
                        "exhaustiveSearch",
                        "fileTypes",
                        "minAccessLevel",
                        "pageOffset",
                        "pageSize"
                      ],
                      "title": "ListDocuments",
                      "type": "object"
                    },
                    "strict": true
                  }
                }
              ]
            }
        "#;
    serde_json::from_str(request).expect("good request")
}

fn expected_failed_tool_calls() -> CreateMessageRequestBody {
    CreateMessageRequestBody {
        model: "claude-haiku-4-5".into(),
        messages: vec![
            RequestMessage {
                role: Role::User,
                content: RequestContent::Text("greetings clanker. list my documents".into()),
            },
            RequestMessage {
                role: Role::Assistant,
                content: RequestContent::Blocks(vec![RequestContentKind::ToolUse {
                    id: "toolu_019UNdEieCsVUEiHXaKgooMM".into(),
                    name: "ListDocuments".into(),
                    input: serde_json::json!({
                        "exhaustiveSearch": true,
                        "fileTypes": [],
                        "minAccessLevel": null,
                        "pageOffset": 0,
                        "pageSize": 100
                    }),
                    cache_control: None,
                }]),
            },
            RequestMessage {
                role: Role::User,
                content: RequestContent::Blocks(vec![RequestContentKind::ToolResult {
                    tool_use_id: "toolu_019UNdEieCsVUEiHXaKgooMM".into(),
                    content: "failed to list documents: HTTP 400 Bad Request: Invalid URL: missing field `document_id`".into(),
                    is_err: None,
                    cache_control: None,
                }]),
            },
            RequestMessage {
                role: Role::Assistant,
                content: RequestContent::Blocks(vec![
                    RequestContentKind::Text {
                        text: "Let me try that again with the proper parameters:".into(),
                        cache_control: None,
                        citations: vec![],
                    },
                    RequestContentKind::ToolUse {
                        id: "toolu_013zTT5ZpforGBtoi3bn2C74".into(),
                        name: "ListDocuments".into(),
                        input: serde_json::json!({
                            "exhaustiveSearch": true,
                            "fileTypes": [],
                            "minAccessLevel": "view",
                            "pageOffset": 0,
                            "pageSize": 100
                        }),
                        cache_control: None,
                    },
                ]),
            },
            RequestMessage {
                role: Role::User,
                content: RequestContent::Blocks(vec![RequestContentKind::ToolResult {
                    tool_use_id: "toolu_013zTT5ZpforGBtoi3bn2C74".into(),
                    content: "failed to list documents: HTTP 400 Bad Request: Invalid URL: missing field `document_id`".into(),
                    is_err: None,
                    cache_control: None,
                }]),
            },
        ],
        max_tokens: 32_000,
        container: None,
        context_management: None,
        mcp_servers: None,
        metadata: None,
        service_tier: None,
        stop_sequences: None,
        stream: Some(true),
        system: Some(SystemPrompt::Text("<system_prompt>".into())),
        temperature: None,
        thinking: None,
        tool_choice: None,
        tools: Some(vec![Tool {
            name: "ListDocuments".into(),
            description: Some("List documents the user has access to with optional filtering and pagination. Only applies to documents, not emails, AI conversations, chat/slack threads, projects aka folders. This tool returns document metadata including access levels and supports filtering by file type, minimum access level, and pagination. Use this tool to discover and browse documents before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.".into()),
            input_schema: serde_json::json!({
                "additionalProperties": false,
                "description": "List documents the user has access to with optional filtering and pagination. Only applies to documents, not emails, AI conversations, chat/slack threads, projects aka folders. This tool returns document metadata including access levels and supports filtering by file type, minimum access level, and pagination. Use this tool to discover and browse documents before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.",
                "properties": {
                    "exhaustiveSearch": {
                        "additionalProperties": false,
                        "default": false,
                        "description": "Exhaustive search to get all results. Defaults to false. Set to true when you need all matching documents, ignoring pagination limits.",
                        "type": "boolean"
                    },
                    "fileTypes": {
                        "additionalProperties": false,
                        "description": "Document file types to include. Examples: ['pdf'], ['md', 'txt']. Leave empty to include all document types.",
                        "items": {
                            "additionalProperties": false,
                            "type": "string"
                        },
                        "type": ["array", "null"]
                    },
                    "minAccessLevel": {
                        "additionalProperties": false,
                        "description": "Minimum access level required. Defaults to 'view' if not specified.",
                        "enum": ["view", "comment", "edit", "owner", null],
                        "type": ["string", "null"]
                    },
                    "pageOffset": {
                        "additionalProperties": false,
                        "default": 0,
                        "description": "Page offset for pagination. Default is 0. Use higher values to get subsequent pages of results.",
                        "format": "int64",
                        "type": "integer"
                    },
                    "pageSize": {
                        "additionalProperties": false,
                        "default": 50,
                        "description": "Number of results per page. Max is 100, default is 50. Use smaller values for focused results.",
                        "format": "int64",
                        "type": "integer"
                    }
                },
                "required": ["exhaustiveSearch", "fileTypes", "minAccessLevel", "pageOffset", "pageSize"],
                "title": "ListDocuments",
                "type": "object"
            })
        }]),
        top_k: None,
        top_p: None,
    }
}

#[test]
fn test_conversion() {
    let oai_request = failed_tool_calls();
    let expected = expected_failed_tool_calls();
    let converted = CreateMessageRequestBody::from(oai_request);
    assert_eq!(converted, expected);
}
