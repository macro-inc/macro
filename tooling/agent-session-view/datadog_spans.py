"""A session's tool and model-call spans from Datadog, for timings the log lacks.

The log has every frame but only coarse times, and nothing about each model
call. The harness's spans have both: one `execute_tool` span per tool call,
carrying the session id as `gen_ai.conversation.id` and the call's id, and one
`chat_streaming` span per model call in the same traces. Field names are in
crates/agent_session/README.md.

Needs DD_API_KEY and DD_APP_KEY in the environment; DD_SITE defaults to
us5.datadoghq.com.
"""
import datetime
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

SERVICE = "service:agent-harness-service"
PAGE_LIMIT = 1000
TRACES_PER_QUERY = 40
PROMPT_SECTIONS = [
    "preamble", "macro_prompt", "identity", "session_instructions", "session_note",
    "opener_note", "memory", "model_id", "connected_integrations", "sdk_docs",
    "unsectioned", "tools.eager", "tools.loaded", "history", "tool_results",
]
# The Spans Search API allows a few hundred requests an hour; a batch export
# waits out a 429 this many times per request before giving up.
RATE_LIMIT_RETRIES = 5
# The start of each definition in `gen_ai.tool.definitions`, a JSON array the
# span cuts at about 25 KB, so it is read with a pattern instead of parsed.
TOOL_DEFINITION = re.compile(r'\{"type":"function","name":"([^"\\]+)"')


class MissingCredentials(Exception):
    pass


def credentials():
    keys = {name: os.environ.get(name) for name in ("DD_API_KEY", "DD_APP_KEY")}
    missing = [name for name, value in keys.items() if not value]
    if missing:
        raise MissingCredentials(f"--datadog needs {' and '.join(missing)} in the environment")
    return keys


def search(query, since, until, keys):
    """Every span matching `query` between `since` and `until`, oldest first."""
    site = os.environ.get("DD_SITE", "us5.datadoghq.com")
    spans, cursor = [], None
    while True:
        page = {"limit": PAGE_LIMIT}
        if cursor:
            page["cursor"] = cursor
        body = {"data": {"type": "search_request", "attributes": {
            "filter": {"query": query, "from": since, "to": until},
            "page": page,
            "sort": "timestamp",
        }}}
        request = urllib.request.Request(
            f"https://api.{site}/api/v2/spans/events/search",
            data=json.dumps(body).encode(),
            headers={
                "Content-Type": "application/json",
                "DD-API-KEY": keys["DD_API_KEY"],
                "DD-APPLICATION-KEY": keys["DD_APP_KEY"],
            },
        )
        result = send(request)
        spans += [span["attributes"] for span in result.get("data") or []]
        cursor = ((result.get("meta") or {}).get("page") or {}).get("after")
        if not cursor:
            return spans


def send(request):
    """The response to `request`, waiting out rate limits; any other failure raises."""
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 or attempt == RATE_LIMIT_RETRIES:
                raise
            wait = rate_limit_wait(error.headers)
            print(f"Datadog rate limit; retrying in {wait:.0f}s", file=sys.stderr)
            time.sleep(wait)
    raise AssertionError("unreachable")


def rate_limit_wait(headers):
    """Seconds until the rate-limit window resets, from Datadog's headers."""
    reset = number(headers.get("X-RateLimit-Reset")) or number(headers.get("Retry-After"))
    return max(reset or 0, 1) + 1


def dig(value, path):
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def number(value):
    """Datadog hands some numeric span fields back as strings."""
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def flag(value):
    return value is True or value == "true"


def epoch_ms(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp() * 1000


def failed(span):
    return span.get("status") == "error" or bool(dig(span.get("custom") or {}, "error"))


def tool(span):
    custom = span.get("custom") or {}
    return {
        "name": dig(custom, "gen_ai.tool.name"),
        "start_ms": epoch_ms(span["start_timestamp"]),
        "end_ms": epoch_ms(span["end_timestamp"]),
        "result_bytes": number(dig(custom, "macro.genai.tool.result_bytes")),
        "result_cut": flag(dig(custom, "macro.genai.tool.result_cut")),
        "failed": failed(span),
    }


def model_call(span):
    custom = span.get("custom") or {}
    prompt = dig(custom, "macro.genai.prompt") or {}
    return {
        "model": dig(custom, "gen_ai.request.model"),
        "start_ms": epoch_ms(span["start_timestamp"]),
        "end_ms": epoch_ms(span["end_timestamp"]),
        "first_chunk_ms": number(dig(custom, "macro.genai.chat.time_to_first_chunk_ms")),
        "first_chunk_kind": dig(custom, "macro.genai.chat.first_chunk_kind"),
        "input_tokens": number(dig(custom, "gen_ai.usage.input_tokens")),
        "output_tokens": number(dig(custom, "gen_ai.usage.output_tokens")),
        "cache_read_tokens": number(dig(custom, "gen_ai.usage.cache_read.input_tokens")),
        "cache_write_tokens": number(dig(custom, "gen_ai.usage.cache_creation.input_tokens")),
        "finish_reasons": dig(custom, "gen_ai.response.finish_reasons"),
        "eager_tools": number(dig(prompt, "tools.eager.count")),
        "loaded_tools": number(dig(prompt, "tools.loaded.count")),
        "prompt_bytes": {
            section: number(dig(prompt, f"{section}.bytes"))
            for section in PROMPT_SECTIONS
            if number(dig(prompt, f"{section}.bytes")) is not None
        },
        # The first 16 hex digits of each section's SHA-256, which a
        # reconstructed section is checked against.
        "prompt_hashes": {
            section: dig(prompt, f"{section}.hash")
            for section in PROMPT_SECTIONS
            if isinstance(dig(prompt, f"{section}.hash"), str)
        },
        "task_definition": task_definition(span),
        "failed": failed(span),
    }


def task_definition(span):
    """The ECS task definition (`family:revision`) that served the span, from
    its tags: the way back to the image, and so the commit, it ran. A family
    alone would name its latest revision, not this one."""
    tags = dict(tag.split(":", 1) for tag in span.get("tags") or [] if ":" in tag)
    if "task_family" not in tags or "task_version" not in tags:
        return None
    return f"{tags['task_family']}:{tags['task_version']}"


def documentation(span):
    """A turn's SDK documentation selection (`select_documentation`): which
    entity indexes Jev put in the prompt, and the `<macro_sdk>` bytes."""
    custom = span.get("custom") or {}
    entities = custom.get("selected_entities") or ""
    return {
        "trace_id": span.get("trace_id"),
        "start_ms": epoch_ms(span["start_timestamp"]),
        "status": custom.get("selection_status"),
        "selected": number(custom.get("selected")),
        "entities": [name for name in entities.split(",") if name],
        "bytes": number(custom.get("bytes")),
        "guidance": custom.get("guidance"),
        "batches": number(custom.get("batches")),
        "task_definition": task_definition(span),
    }


def cut_json(text):
    """Whether `text` is JSON cut short. `macro.genai.content_truncated` says
    nothing about the tool list alone, and Datadog cuts long strings itself."""
    try:
        json.loads(text or "[]")
    except ValueError:
        return True
    return False


def tool_offer(span):
    """The names of the tools a turn's MCP servers offered, eager and
    deferred alike, from its `invoke_agent` span. Only names are kept."""
    custom = span.get("custom") or {}
    definitions = dig(custom, "gen_ai.tool.definitions") or ""
    return {
        "start_ms": epoch_ms(span["start_timestamp"]),
        "end_ms": epoch_ms(span["end_timestamp"]),
        "names": list(dict.fromkeys(TOOL_DEFINITION.findall(definitions))),
        "cut": cut_json(definitions),
    }


def fetch(session_id, since, until):
    """The session's spans, by kind:

    - "tools": {tool call id: [timing, ...]}
    - "model_calls": one row per `chat_streaming` span
    - "documentation": one row per `select_documentation` span
    - "tool_offers": the tool names on each `invoke_agent` span

    A provider can reuse a tool call id within a session, so each id maps to
    every span carrying it, oldest first; the n-th call with that id takes
    the n-th span.

    `since` and `until` are ISO timestamps bounding the session's log.
    """
    keys = credentials()
    session_spans = search(
        f"{SERVICE} @gen_ai.conversation.id:{session_id} "
        "(@gen_ai.operation.name:execute_tool OR resource_name:invoke_agent)",
        since, until, keys,
    )
    tools = {}
    offers = []
    for span in session_spans:
        if span.get("resource_name") == "invoke_agent":
            offers.append(tool_offer(span))
        call_id = dig(span.get("custom") or {}, "gen_ai.tool.call.id")
        if dig(span.get("custom") or {}, "gen_ai.operation.name") == "execute_tool" and call_id:
            tools.setdefault(call_id, []).append(tool(span))
    traces = sorted({span["trace_id"] for span in session_spans if span.get("trace_id")})
    # Neither span carries the session id; both are found through the
    # traces of the session's own spans.
    calls, selections = [], []
    for start in range(0, len(traces), TRACES_PER_QUERY):
        batch = " OR ".join(traces[start:start + TRACES_PER_QUERY])
        query = f"{SERVICE} resource_name:(chat_streaming OR select_documentation) trace_id:({batch})"
        for span in search(query, since, until, keys):
            if span.get("resource_name") == "select_documentation":
                selections.append(documentation(span))
            else:
                calls.append(model_call(span))
    for rows in (calls, selections, offers):
        rows.sort(key=lambda row: row["start_ms"])
    return {"tools": tools, "model_calls": calls, "documentation": selections, "tool_offers": offers}
