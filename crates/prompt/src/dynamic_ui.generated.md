`displayResults` renders a rich, interactive view (lists, timelines, channel messages) directly in the conversation — the chat, or the transcript of an agent session. PREFER it over a plain-text answer whenever your response is largely about the user's workspace data — summaries of tasks/docs/activity, lists of entities, anything you would otherwise format as a markdown table or a long bulleted list. You do NOT need the user to ask for a "dashboard" or a "view": proactively call `displayResults` whenever it presents the information more clearly than text would.
Typical triggers — call it even though the user never said "dashboard": "what did I get done this week?", "what's <teammate> working on?", "show me my open tasks", "summarize this project", "what happened in <channel>?". When in doubt and the answer is mostly workspace entities or metrics, render a view.
`ReadActivity` is the exception: it already renders its complete, entity-resolved response as a rich user-facing activity timeline. After calling `ReadActivity`, do NOT call `displayResults` to restate or summarize those events. Add at most one short textual takeaway.
When you DO render a view, keep any accompanying text short (a one-line lead-in at most) — the view IS the answer; do not also restate it in prose.
Its `view` argument MUST be a JSON object matching this JSON Schema (a `title` plus an ordered `widgets` array; layout is flexbox via the `container` widget):
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "title": {
      "type": "string"
    },
    "widgets": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/__schema0"
      }
    }
  },
  "required": [
    "widgets"
  ],
  "additionalProperties": false,
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "md"
            },
            "markdown": {
              "type": "string"
            }
          },
          "required": [
            "type",
            "markdown"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "timeline"
            },
            "title": {
              "type": "string"
            },
            "events": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "time": {
                    "type": "string"
                  },
                  "title": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  },
                  "entity": {
                    "type": "object",
                    "properties": {
                      "id": {
                        "type": "string"
                      },
                      "type": {
                        "type": "string",
                        "enum": [
                          "user",
                          "chat",
                          "channel",
                          "channel_message",
                          "document",
                          "project",
                          "email_thread",
                          "calendar_event",
                          "team",
                          "call",
                          "foreign_entity",
                          "static_file",
                          "crm_company",
                          "crm_contact",
                          "reminder",
                          "skill",
                          "agent_session",
                          "scheduled_action",
                          "initiative",
                          "email",
                          "automation",
                          "channel_thread"
                        ]
                      }
                    },
                    "required": [
                      "id",
                      "type"
                    ],
                    "additionalProperties": false
                  },
                  "future": {
                    "type": "boolean"
                  }
                },
                "required": [
                  "time",
                  "title"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "type",
            "events"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "list"
            },
            "title": {
              "type": "string"
            },
            "source": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "query"
                    },
                    "query": {}
                  },
                  "required": [
                    "kind",
                    "query"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "items"
                    },
                    "entities": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "type": {
                            "type": "string",
                            "enum": [
                              "user",
                              "chat",
                              "channel",
                              "channel_message",
                              "document",
                              "project",
                              "email_thread",
                              "calendar_event",
                              "team",
                              "call",
                              "foreign_entity",
                              "static_file",
                              "crm_company",
                              "crm_contact",
                              "reminder",
                              "skill",
                              "agent_session",
                              "scheduled_action",
                              "initiative",
                              "email",
                              "automation",
                              "channel_thread"
                            ]
                          }
                        },
                        "required": [
                          "id",
                          "type"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "required": [
                    "kind",
                    "entities"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            "groupBy": {
              "type": "string",
              "enum": [
                "date",
                "entity_type",
                "project"
              ]
            },
            "limit": {
              "type": "number"
            }
          },
          "required": [
            "type",
            "source"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "channelMessage"
            },
            "channelId": {
              "type": "string"
            },
            "messageId": {
              "type": "string"
            }
          },
          "required": [
            "type",
            "channelId",
            "messageId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "const": "container"
            },
            "direction": {
              "type": "string",
              "enum": [
                "row",
                "col"
              ]
            },
            "gap": {
              "type": "number"
            },
            "wrap": {
              "type": "boolean"
            },
            "align": {
              "type": "string",
              "enum": [
                "start",
                "center",
                "end",
                "stretch"
              ]
            },
            "justify": {
              "type": "string",
              "enum": [
                "start",
                "center",
                "end",
                "between"
              ]
            },
            "title": {
              "type": "string"
            },
            "children": {
              "type": "array",
              "items": {
                "$ref": "#/$defs/__schema0"
              }
            }
          },
          "required": [
            "type",
            "children"
          ],
          "additionalProperties": false
        }
      ]
    }
  }
}
```
Entity-backed widgets (`list`, `timeline`, `channelMessage`) take real workspace entity ids — use ids you obtained from other tools (ListEntities, search, etc.), never invented ones.
