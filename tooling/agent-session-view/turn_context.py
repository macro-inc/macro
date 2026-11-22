"""What the model had in each turn, from the session's spans: the SDK docs
selected, the tools offered, the size of each prompt part, and flags.

No prompt text is logged anywhere, so this is the turn's shape: names, counts
and byte sizes. The spans hold no tool names for the eager set (only its count
and bytes), so eager names come from the known eager lists in the repository's
source at HEAD, kept only where the session shows the tool was there: offered
on its `invoke_agent` span, called, or named by SearchTools as already
available. That is the source as checked out here, not necessarily the build
that served the session; the span count is the authority.
"""
import json
import pathlib
import re

import markdown_export

REPO = pathlib.Path(__file__).resolve().parents[2]
# (file, constant) pairs holding the names of tools whose schemas go out with
# every request.
EAGER_SOURCES = [
    ("crates/ai_tools/src/lib.rs", "EAGER_TOOLS"),
    ("crates/agent_inmem/src/rig_engine.rs", "EAGER_INTERNAL_MCP_TOOLS"),
]
INTERNAL_PREFIX = "mcp__macro_internal__"
DESCRIBE_TOOLS = "DescribeCodeTools"
GUESSED_METHOD = re.compile(r"is not a function")
HUGE_RESULT_BYTES = 60_000
SLOW_MODEL_SECONDS = 15
REPEATED_FAILURES = 3
# Prompt parts by what they are, in the order the viewer stacks them.
PROMPT_GROUPS = [
    ("system", ["preamble", "identity", "session_instructions", "session_note", "opener_note", "memory",
                "model_id", "connected_integrations", "unsectioned"]),
    ("macro prompt + area guides", ["macro_prompt"]),
    ("<macro_sdk>", ["sdk_docs"]),
    ("tools", ["tools.eager", "tools.loaded"]),
    ("history", ["history"]),
    ("tool results", ["tool_results"]),
]


def eager_names_from_source(repo=REPO):
    """Every name in the eager lists, or None when a list cannot be read: an
    unknown set is shown as unknown, never guessed."""
    names = []
    for path, constant in EAGER_SOURCES:
        try:
            text = (repo / path).read_text()
        except OSError:
            return None
        match = re.search(rf"const {constant}: &\[&str\] = &\[(.*?)\];", text, re.S)
        found = re.findall(r'"([^"]+)"', match.group(1)) if match else []
        if not found:
            return None
        names += [bare(name) for name in found]
    return names


def bare(name):
    """A tool's name without the internal MCP server's prefix."""
    return name[len(INTERNAL_PREFIX):] if name.startswith(INTERNAL_PREFIX) else name


def parsed(result):
    try:
        value = json.loads(result or "")
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def loaded_tools(steps):
    """The deferred tools a turn's SearchTools and LoadTools calls loaded.
    SearchTools loads its `results`; `additional_matches` stay unloaded."""
    loaded = []
    for step in steps:
        name = bare(step.name)
        if name not in ("SearchTools", "LoadTools"):
            continue
        result = parsed(step.result)
        matches = result.get("results") if name == "SearchTools" else result.get("loaded")
        for match in matches or []:
            if isinstance(match, dict) and match.get("name"):
                loaded.append({"name": match["name"], "step": step.number, "tool": step.tool_number, "via": name})
    return loaded


def already_available(steps):
    names = set()
    for step in steps:
        if bare(step.name) == "SearchTools":
            names.update(bare(name) for name in parsed(step.result).get("already_available") or [])
    return names


def in_turn(rows, turn, after, slack=5):
    """Rows that started within the turn, allowing `slack` seconds before its
    prompt frame was appended but never reaching back past `after`, the end
    of the turn before."""
    earliest = max(turn.started - slack, after)
    return [row for row in rows if earliest < row["start_ms"] / 1000 <= turn.bound]


def prompt_parts(call):
    parts = call.get("prompt_bytes") or {}
    return [
        {"group": group, "parts": {name: parts[name] for name in names if parts.get(name)}}
        for group, names in PROMPT_GROUPS
    ]


def turn_context(turn, after, spans, eager_source, session_tools, session_available):
    """The context of one turn of `markdown_export.parse`."""
    calls = markdown_export.model_calls(spans, turn)
    # The turn's own model calls offer tools; a side call (the session's
    # title) offers none.
    agent_calls = [call for call in calls if call.get("eager_tools")]
    last = agent_calls[-1] if agent_calls else None
    selections = in_turn(spans.get("documentation") or [], turn, after)
    offers = in_turn(spans.get("tool_offers") or [], turn, after)
    offered = list(dict.fromkeys(bare(name) for offer in offers for name in offer["names"]))

    eager_count = last.get("eager_tools") if last else None
    if eager_source is None:
        eager_names = None
    else:
        present = set(offered) | session_tools | session_available
        eager_names = [name for name in dict.fromkeys(eager_source) if name in present]
    loaded = loaded_tools(turn.steps)
    loaded_names = {entry["name"] for entry in loaded}
    # Without the eager names, eager and deferred can't be told apart.
    deferred = None if eager_names is None else [
        name for name in offered if name not in eager_names and name not in loaded_names
    ]

    context = {
        "turn": turn.number,
        "documentation": selections[-1] if selections else None,
        "tools": {
            "eager": {
                "count": eager_count,
                "bytes": (last.get("prompt_bytes") or {}).get("tools.eager") if last else None,
                "names": eager_names,
            },
            "loaded": loaded,
            "loaded_count": last.get("loaded_tools") if last else None,
            "loaded_bytes": (last.get("prompt_bytes") or {}).get("tools.loaded") if last else None,
            "offered": len(offered),
            "offered_cut": any(offer["cut"] for offer in offers),
            "deferred": deferred,
        },
        "prompt": {
            "calls": len(agent_calls),
            "largest": prompt_parts(max(agent_calls, key=lambda call: call.get("input_tokens") or 0))
            if agent_calls else None,
        },
    }
    # Exports made before the docs selection was fetched have no key for it:
    # a missing span there proves nothing.
    context["flags"] = flags(turn, context, "documentation" in spans)
    return context


def flags(turn, context, selections_fetched):
    """Cheap signs of a turn that went wrong, each {id, level, text}."""
    found = []
    tools = [step for step in turn.steps if step.kind == "tool"]
    code_runs = [step for step in tools if step.name in markdown_export.CODE_TOOLS]
    selection = context["documentation"]

    if selection and (selection["selected"] == 0 or selection["status"] != "selected"):
        found.append({
            "id": "no-sdk-index", "level": "warn",
            "text": f"No SDK index loaded: {count(selection['selected'])} entities selected "
                    f"(status {selection['status']}), <macro_sdk> {count(selection['bytes'])} bytes, catalog only",
        })
    elif selections_fetched and code_runs and not selection:
        found.append({"id": "no-docs-span", "level": "info",
                      "text": "ExecuteCode ran but no select_documentation span was found"})

    guessed = [step for step in code_runs if step.error and GUESSED_METHOD.search(step.error)]
    described = any(bare(step.name) == DESCRIBE_TOOLS for step in tools)
    if guessed and not described:
        found.append({
            "id": "guessed-sdk-methods", "level": "warn",
            "text": f"DescribeCodeTools never called while {len(guessed)} ExecuteCode runs hit `is not a function`",
            **where(guessed),
        })

    failures = {}
    for step in tools:
        if step.error:
            failures.setdefault((step.name, step.error[:80]), []).append(step)
    for (name, error), steps in failures.items():
        if len(steps) >= REPEATED_FAILURES:
            found.append({"id": "repeated-failure", "level": "warn",
                          "text": f"{bare(name)} failed {len(steps)} times the same way: {error}", **where(steps)})
    failed_code = [step for step in code_runs if step.error]
    if len(failed_code) >= REPEATED_FAILURES:
        found.append({"id": "failing-code", "level": "warn",
                      "text": f"{len(failed_code)} of {len(code_runs)} ExecuteCode runs failed", **where(failed_code)})

    sizes = [result_bytes(step) for step in tools]
    huge = [size for size in sizes if size >= HUGE_RESULT_BYTES]
    if huge:
        found.append({"id": "huge-result", "level": "info",
                      "text": f"Tool results of 60 KB or more: {len(huge)}, largest {max(huge) / 1000:.0f} KB"})

    slow = [step for step in turn.steps if step.gap > SLOW_MODEL_SECONDS]
    if slow:
        found.append({"id": "slow-model-round", "level": "info",
                      "text": f"{len(slow)} model gaps over {SLOW_MODEL_SECONDS}s "
                              f"(longest {max(step.gap for step in slow):.0f}s)"})

    eager = context["tools"]["eager"]
    if eager["count"] is not None:
        if eager["names"] is None:
            found.append({"id": "eager-names-unknown", "level": "warn",
                          "text": f"Eager tool names unknown: the eager lists in the source could not be read "
                                  f"({count(eager['count'])} eager per span)"})
        # Fewer names than the count is the norm (code mode's own tools are
        # not in the lists); more means the source and the build disagree.
        elif len(eager["names"]) > eager["count"]:
            found.append({"id": "eager-names-exceed-span", "level": "warn",
                          "text": f"{len(eager['names'])} eager tools named from source, but the span "
                                  f"counts {count(eager['count'])}: the source differs from the build"})
    return found


def where(steps):
    """The steps a flag points at: step numbers (the markdown's) and tool
    call numbers (the viewer's)."""
    return {"steps": [step.number for step in steps], "tools": [step.tool_number for step in steps]}


def count(value):
    return "?" if value is None else f"{value:.0f}"


def result_bytes(step):
    """A tool result's size: its span's, or the logged result's."""
    if step.span and step.span.get("result_bytes") is not None:
        return step.span["result_bytes"]
    return len((step.result or "").encode())


def for_session(export, eager_source):
    """The context of every turn, in turn order; empty without spans.
    `eager_source` is `eager_names_from_source()`, None when unknown."""
    spans = export.get("spans")
    if not spans:
        return []
    turns = markdown_export.parse(export["frames"], spans.get("tools"))
    steps = [step for turn in turns for step in turn.steps if step.kind == "tool"]
    session_tools = {bare(step.name) for step in steps}
    session_available = already_available(steps)
    afters = [float("-inf")] + [turn.bound for turn in turns[:-1]]
    return [
        turn_context(turn, after, spans, eager_source, session_tools, session_available)
        for turn, after in zip(turns, afters)
    ]
