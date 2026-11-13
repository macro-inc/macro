"""Dense markdown for one agent session, written for agents that read many.

The main file has a header (model, turns, tool calls, failures, where the time
went, the slowest gaps) and, per turn, a step table followed by each tool
call's code and result cut to a budget. The uncut code and results go to a
side file, under the same step numbers. With the session's spans (`--datadog`)
tool steps take their start and end from their `execute_tool` span, and each
turn lists its model calls.
"""
import datetime
import json
import re

CODE_BUDGET = 1500
RESULT_BUDGET = 1200
TEXT_BUDGET = 1500
SLOWEST_GAPS = 8

AGENT_CONTEXT = re.compile(r"<m-agent-context>.*?</m-agent-context>", re.S)
CODE_TOOLS = {"ExecuteCode", "mcp__macro_internal__ExecuteCode"}
# Code-mode statuses of a program that did not succeed.
FAILED_PROGRAM = ("failed", "timed_out", "cancelled")


def seconds(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()


def cut(text, budget):
    if len(text) <= budget:
        return text
    return text[:budget] + f"\n…[{len(text) - budget} more chars in the full file]"


def first_line(value):
    """The first non-blank line of `value`, a structured error as JSON."""
    text = value if isinstance(value, str) or value is None else json.dumps(value, ensure_ascii=False)
    for line in (text or "").splitlines():
        if line.strip():
            return line.strip()[:160]
    return ""


def prompt_text(params):
    parts = [part.get("text", "") for part in params.get("prompt") or [] if part.get("text")]
    return AGENT_CONTEXT.sub("[agent context]", "\n".join(parts)).strip()


def tool_name(update):
    meta = ((update.get("_meta") or {}).get("macro") or {})
    return meta.get("toolName") or update.get("title") or "?"


def result_body(update):
    raw = update.get("rawOutput")
    value = raw if raw is not None else update.get("content")
    if isinstance(value, str):
        return value
    return json.dumps(value, indent=1, ensure_ascii=False)


def failure(update, body):
    """The first error line of a finished call, or None when it succeeded.

    The same predicate as the HTML viewer's: the call failed, or its result
    reports a failed program or carries an error.
    """
    raw = update.get("rawOutput")
    error = raw.get("error") if isinstance(raw, dict) else None
    if update.get("status") == "failed":
        return first_line(error or body) or "failed"
    # Code mode returns a failed program as a result, not a failed call.
    if isinstance(raw, dict) and (raw.get("status") in FAILED_PROGRAM or error):
        return first_line(error or raw["status"]) or "failed"
    return None


def fence(text, info=""):
    """`text` in a code fence longer than any backtick run inside it."""
    longest = max((len(run) for run in re.findall(r"`+", text)), default=0)
    marks = "`" * max(3, longest + 1)
    return f"{marks}{info}\n{text}\n{marks}"


def union_seconds(intervals):
    """How long any of the intervals covers, overlaps counted once."""
    total, current = 0.0, None
    for start, end in sorted(interval for interval in intervals if interval[1] > interval[0]):
        if current and start <= current[1]:
            current[1] = max(current[1], end)
        else:
            if current:
                total += current[1] - current[0]
            current = [start, end]
    return total + (current[1] - current[0] if current else 0)


class Turn:
    def __init__(self, number, started, prompt):
        self.number = number
        self.started = started
        self.prompt = prompt
        self.steps = []
        self.ended = None
        self.last = started
        self.stop = None
        self.answer = []

    @property
    def bound(self):
        """When the turn ended, or its last frame when it never did."""
        return self.ended if self.ended is not None else self.last


class Step:
    def __init__(self, number, kind, started, gap, name=""):
        self.number = number
        self.kind = kind
        self.started = started
        self.gap = gap
        self.name = name
        self.ended = started
        self.chars = 0
        self.status = ""
        self.error = None
        self.code = None
        self.arguments = None
        self.result = None
        self.span = None

    @property
    def duration(self):
        return self.ended - self.started


def parse(frames, tool_spans=None):
    """Fold frames into turns of steps: think, say, or tool.

    A tool step with a span in `tool_spans` (by tool call id) runs from the
    span's start to its end instead of between its frames. A reused id takes
    its spans in order.
    """
    tool_spans = tool_spans or {}
    seen = {}
    turns = []
    turn = None
    step = None
    previous = None
    calls = {}
    for frame in frames:
        content = frame["content"]
        t = seconds(frame["t"])
        method = content.get("method")
        if method == "session/prompt":
            turn = Turn(len(turns) + 1, t, prompt_text(content.get("params") or {}))
            turns.append(turn)
            step, previous = None, t
            continue
        if turn is None:
            continue
        turn.last = t
        update = (content.get("params") or {}).get("update") or {}
        kind = update.get("sessionUpdate")
        if kind in ("agent_thought_chunk", "agent_message_chunk"):
            text = (update.get("content") or {}).get("text", "")
            wanted = "think" if kind == "agent_thought_chunk" else "say"
            if step is None or step.kind != wanted:
                step = Step(len(turn.steps) + 1, wanted, t, t - previous)
                turn.steps.append(step)
            step.chars += len(text)
            step.ended = t
            if wanted == "say":
                turn.answer.append(text)
        elif kind == "tool_call":
            turn.answer = []
            call_id = update.get("toolCallId")
            span = nth_span(tool_spans.get(call_id), seen.get(call_id, 0))
            seen[call_id] = seen.get(call_id, 0) + 1
            started = span["start_ms"] / 1000 if span else t
            step = Step(len(turn.steps) + 1, "tool", started, started - previous, tool_name(update))
            step.span = span
            raw = dict(update.get("rawInput") or {})
            step.code = raw.pop("source", None)
            step.arguments = raw
            step.status = update.get("status") or "pending"
            calls[update.get("toolCallId")] = step
            turn.steps.append(step)
            if update.get("status") in ("completed", "failed"):
                finish(step, update, t)
            previous = step.ended
            continue
        elif kind == "tool_call_update" and update.get("status") in ("completed", "failed"):
            called = calls.get(update.get("toolCallId"))
            step = None
            if called is not None:
                finish(called, update, t)
                previous = called.ended
                continue
        elif (content.get("result") or {}).get("stopReason"):
            turn.ended, turn.stop = t, content["result"]["stopReason"]
            step = None
        elif content.get("error") and "id" in content:
            turn.ended, turn.stop = t, "error: " + first_line(json.dumps(content["error"]))
            step = None
        else:
            continue
        previous = t
    return turns


def nth_span(spans, n):
    """The n-th span for a tool call id; an older export holds one, not a list."""
    if isinstance(spans, dict):
        spans = [spans]
    return spans[n] if spans and n < len(spans) else None


def finish(step, update, t):
    step.ended = step.span["end_ms"] / 1000 if step.span else t
    step.status = update.get("status")
    step.result = result_body(update)
    step.error = failure(update, step.result)
    if step.error:
        step.status = "failed"


class Totals:
    """What the header and the batch index say about a session."""

    def __init__(self, turns):
        steps = [step for turn in turns for step in turn.steps]
        tools = [step for step in steps if step.kind == "tool"]
        self.turns = len(turns)
        self.tool_calls = len(tools)
        self.failed = sum(1 for step in tools if step.error)
        self.code_runs = sum(1 for step in tools if step.name in CODE_TOOLS)
        self.model_time = sum(step.gap for step in steps)
        self.tool_time = sum(
            union_seconds([(step.started, step.ended) for step in turn.steps if step.kind == "tool"])
            for turn in turns
        )
        self.wall = sum(turn.bound - turn.started for turn in turns)


def render(export):
    """The main markdown and the side file of uncut code and results."""
    session = export["session"]
    spans = export.get("spans")
    turns = parse(export["frames"], (spans or {}).get("tools"))
    totals = Totals(turns)
    sid = session.get("id")

    out = [
        f"# {session.get('name') or 'Untitled session'}",
        "",
        f"- session `{sid}`, model `{session.get('model')}`, created {session.get('created_at')}",
        f"- {totals.turns} turns, {totals.tool_calls} tool calls ({totals.failed} failed), "
        f"{totals.code_runs} code runs",
        f"- turn wall time {totals.wall:.0f}s: model gaps {totals.model_time:.0f}s, "
        f"tool time {totals.tool_time:.0f}s, "
        f"other {max(totals.wall - totals.model_time - totals.tool_time, 0):.0f}s",
        "- times are when each frame was appended (its log id); tool times come from "
        + ("their execute_tool spans" if spans else "their frames, so streamed output between "
           "them counts as tool time; pass --datadog for span timings"),
        "",
        "## Slowest gaps",
        "",
        "| turn | step | gap | before |",
        "| --- | --- | --- | --- |",
    ]
    ranked = sorted(
        ((turn, step) for turn in turns for step in turn.steps), key=lambda pair: -pair[1].gap
    )[:SLOWEST_GAPS]
    for turn, step in ranked:
        out.append(f"| {turn.number} | {step.number} | {step.gap:.1f}s | {step.kind} {step.name} |")
    if totals.failed:
        out += ["", "## Failures", ""]
        for turn in turns:
            for step in turn.steps:
                if step.error:
                    out.append(f"- turn {turn.number} step {step.number} `{step.name}`: {step.error}")

    full = [f"# Full code and results: {sid}", ""]
    for turn in turns:
        took = f"{turn.ended - turn.started:.0f}s" if turn.ended else "unfinished"
        out += [
            "",
            f"## Turn {turn.number} ({took}, {turn.stop or 'no stop'})",
            "",
            "Prompt:",
            "",
            "> " + cut(turn.prompt, TEXT_BUDGET).replace("\n", "\n> "),
            "",
            "| # | at | gap | kind | tool | size | took | status | error |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for step in turn.steps:
            size = len(step.result or "") if step.kind == "tool" else step.chars
            took = f"{step.duration:.1f}s" if step.kind == "tool" else ""
            error = (step.error or "").replace("|", "\\|")
            out.append(
                f"| {step.number} | +{step.started - turn.started:.1f}s | {step.gap:.1f}s | {step.kind} "
                f"| {step.name} | {size} | {took} | {step.status} | {error} |"
            )
        for step in turn.steps:
            if step.kind != "tool":
                continue
            out.append(f"\n### {turn.number}.{step.number} {step.name}\n")
            full.append(f"## {turn.number}.{step.number} {step.name}\n")
            if step.arguments:
                arguments = json.dumps(step.arguments, ensure_ascii=False)
                out.append("Args: `" + cut(arguments, RESULT_BUDGET).replace("`", "'") + "`\n")
                full.append("Args:\n" + fence(arguments, "json") + "\n")
            if step.code:
                out.append(fence(cut(step.code.rstrip(), CODE_BUDGET), "js") + "\n")
                full.append(fence(step.code.rstrip(), "js") + "\n")
            if step.result is not None:
                out.append("Result:\n" + fence(cut(step.result, RESULT_BUDGET)))
                full.append("Result:\n" + fence(step.result) + "\n")
        calls = model_calls(spans, turn) if spans else []
        if calls:
            out += [
                "",
                "Model calls:",
                "",
                "| at | took | first chunk | model | input | cache read | cache write | output | finish | largest prompt parts |",
                "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
            for call in calls:
                largest = sorted(call["prompt_bytes"].items(), key=lambda part: -part[1])[:3]
                out.append(
                    f"| +{call['start_ms'] / 1000 - turn.started:.1f}s "
                    f"| {(call['end_ms'] - call['start_ms']) / 1000:.1f}s "
                    f"| {seconds_text(call['first_chunk_ms'])} {call['first_chunk_kind'] or ''} "
                    f"| {call['model']} | {count_text(call['input_tokens'])} "
                    f"| {count_text(call['cache_read_tokens'])} | {count_text(call['cache_write_tokens'])} "
                    f"| {count_text(call['output_tokens'])} | {', '.join(call['finish_reasons'] or [])} "
                    f"| {', '.join(f'{name} {size / 1000:.0f} KB' for name, size in largest)} |"
                )
        answer = "".join(turn.answer).strip()
        if answer:
            out += ["", "Answer:", "", cut(answer, TEXT_BUDGET)]
    return "\n".join(out) + "\n", "\n".join(full) + "\n"


def model_calls(spans, turn):
    """The model calls that started within the turn (up to its last frame
    when it never ended)."""
    return [
        call for call in spans["model_calls"]
        if turn.started <= call["start_ms"] / 1000 <= turn.bound
    ]


def seconds_text(millis):
    return "" if millis is None else f"{millis / 1000:.1f}s"


def count_text(value):
    return "" if value is None else f"{value:.0f}"


def index_row(export):
    session = export["session"]
    totals = Totals(parse(export["frames"], (export.get("spans") or {}).get("tools")))
    name = (session.get("name") or "").replace("|", "/")
    return (
        f"| [{session['id']}]({session['id']}.md) | {name} | {session.get('model')} "
        f"| {str(session.get('created_at'))[:16]} | {totals.turns} | {totals.tool_calls} "
        f"| {totals.failed} | {totals.wall:.0f}s | {totals.model_time:.0f}s | {totals.tool_time:.0f}s |"
    )


def index(rows, filters):
    shown = {key: value for key, value in filters.items() if key in (
        "env", "since", "until", "owner", "model", "include_routines", "min_seconds", "min_tools", "limit",
        "datadog",
    ) and value not in (None, "", False, 0)}
    return "\n".join([
        "# Agent sessions",
        "",
        "Filters: " + ", ".join(f"{key}={value}" for key, value in shown.items()),
        "",
        "Each session has `<id>.md` (summary) and `<id>.full.md` (uncut code and results).",
        "",
        "| session | name | model | created | turns | tools | failed | wall | model gaps | tool time |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        *rows,
    ]) + "\n"
