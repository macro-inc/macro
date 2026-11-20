"""A session's tokens and cost: the `chat_streaming` spans reconciled with the
`ai_usage` rows billed to the session.

`ai_usage` is the authority for cost and totals; spans give per-round detail.
The two are never added together. Providers count differently, so each span
is first normalized to four disjoint counters (uncached input, cache read,
cache write, output), the same split the `ai_usage` recorder stores:

- Anthropic reports input without the cached tokens, as stored.
- Gemini and OpenAI report input including the cached tokens, so uncached is
  input minus cache read.

How many spans one row covers depends on the caller: some record one row per
model round (Opus), others one row per turn summing its rounds (Gemini,
Sonnet). A row is matched to the shortest run of
its model's unclaimed spans with usage in its turn, from any start, whose
input counters sum to it exactly; between equal runs, the one ending nearest
the row. A row's model is its price key (`crates/agent/src/model/metering/per_call.rs`),
which can add speed or long-context suffixes (`claude-opus-5-5:fast`,
`gpt-5.6:priority:long`) to the bare model the spans carry. Billed output includes reasoning tokens; Gemini spans' output does
not, so a row's output may exceed its spans' by the reasoning (never less).
"""
import datetime
import re

import markdown_export

COUNTERS = ("uncached", "cache_read", "cache_write", "output")

# A row is written just before its span (Anthropic, ~10 ms) or when the turn's
# stream ends (AI SDK); spans ending up to this long after a row can be its own.
ROW_AFTER_SPAN_MS = 2000
# A turn's rows are written as its last round closes, which can be a moment
# after the turn's stop frame.
ROW_AFTER_TURN_S = 5
# A step's first frame is appended as the round streams, or just after the
# round's span closes (tool call frames).
FRAME_AFTER_ROUND_MS = 250
# A call wrote at least this share of its context to the cache: the cache
# missed and the whole prompt was written again.
CACHE_MISS_SHARE = 0.5
CACHE_MISS_MIN_TOKENS = 10_000

# The opener: a fast model racing the turn's own for its first line
# (`MODEL` and `MAX_TOKENS` in crates/agent_inmem/src/outbound/rig_engine/opener.rs).
# Its spans carry no tag of their own: it is the model with no tools offered
# and at most that many output tokens.
OPENER_MODEL = "gpt-5.4-mini"
OPENER_MAX_OUTPUT = 64
OPENER_LABEL = "opener (fast first line)"

STEP_UPDATES = ("agent_thought_chunk", "agent_message_chunk", "tool_call")


def timestamp_ms(value):
    """A frame time or a Postgres timestamptz as JSON renders it (fraction
    trimmed of zeros, offset as `+00`)."""
    value = re.sub(r"\.(\d{1,6})", lambda match: "." + match.group(1).ljust(6, "0"), str(value), count=1)
    value = re.sub(r"([+-]\d\d)$", r"\1:00", value.replace("Z", "+00:00").replace(" ", "T", 1))
    return datetime.datetime.fromisoformat(value).timestamp() * 1000


def provider(model):
    model = (model or "").lower()
    if model.startswith("claude") or "anthropic" in model:
        return "anthropic"
    if model.startswith("gemini") or "google" in model:
        return "google"
    if model.startswith(("gpt", "o1", "o3", "o4")) or "openai" in model:
        return "openai"
    return "unknown"


def bare_model(price_key):
    """The model a price key bills, without its `:fast` / `:long` suffixes."""
    return (price_key or "").split(":", 1)[0] or price_key


def pricing(price_key):
    """A price key's suffixes (`fast`, `priority:long`), or None."""
    return (price_key or "").partition(":")[2] or None


def counters(call):
    """The span's four disjoint counters, or None when it reported no usage."""
    values = [call.get(key) for key in ("input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens")]
    if all(value is None for value in values):
        return None
    tokens, read, write, output = (int(value or 0) for value in values)
    uncached = tokens - read if provider(call.get("model")) in ("google", "openai") else tokens
    return {"uncached": max(uncached, 0), "cache_read": read, "cache_write": write, "output": output}


def row_counters(row):
    return {
        "uncached": int(row.get("input_tokens") or 0),
        "cache_read": int(row.get("cache_read_input_tokens") or 0),
        "cache_write": int(row.get("cache_write_input_tokens") or 0),
        "output": int(row.get("output_tokens") or 0),
    }


def same_billing(spans, row):
    """Spans add up to the row: equal input counters, and the row's output at
    least the spans' (the rest is reasoning the span does not count)."""
    return all(spans[key] == row[key] for key in COUNTERS[:3]) and row["output"] >= spans["output"]


def context(tokens):
    """Tokens the model read in the call, cached or not."""
    return tokens["uncached"] + tokens["cache_read"] + tokens["cache_write"]


def total(many):
    out = dict.fromkeys(COUNTERS, 0)
    for tokens in many:
        for key in COUNTERS:
            out[key] += tokens[key]
    return out


def is_opener(call, tokens):
    return (
        call.get("model") == OPENER_MODEL and not call.get("eager_tools") and not call.get("loaded_tools")
        and tokens is not None and tokens["output"] <= OPENER_MAX_OUTPUT
    )


def is_cache_miss(call, tokens, warm):
    """A call that wrote most of a large context to the cache again. A model's
    first call in the session (`warm` false) is a cold write, not a miss."""
    return (
        warm and tokens is not None and provider(call.get("model")) == "anthropic"
        and context(tokens) >= CACHE_MISS_MIN_TOKENS
        and tokens["cache_write"] >= CACHE_MISS_SHARE * context(tokens)
    )


def turn_of(turns, seconds):
    for turn in turns:
        if turn.started <= seconds <= turn.bound:
            return turn.number
    return None


def row_turns(turns, seconds):
    """The turns a row can belong to, most likely first: the one containing
    it, then the last one it trails by at most `ROW_AFTER_TURN_S` (a turn's
    rows can come after its stop frame, even once a queued turn started)."""
    trailed = [turn.number for turn in turns if turn.bound < seconds <= turn.bound + ROW_AFTER_TURN_S]
    containing = turn_of(turns, seconds)
    return [number for number in [containing, *trailed[-1:]] if number is not None]


def matching_run(spans, expected, created_ms):
    """The shortest run of the spans (in end order) summing to the row, from
    any start; between equal lengths, the one ending nearest the row."""
    sums = [dict.fromkeys(COUNTERS, 0)]
    for call in spans:
        sums.append({key: sums[-1][key] + call["tokens"][key] for key in COUNTERS})
    for length in range(1, len(spans) + 1):
        matches = [
            spans[start:start + length] for start in range(len(spans) - length + 1)
            if same_billing({key: sums[start + length][key] - sums[start][key] for key in COUNTERS}, expected)
        ]
        if matches:
            return min(matches, key=lambda run: abs(created_ms - run[-1]["end_ms"]))
    return None


def cost(rows):
    """The rows' summed `total`, or None when any is unpriced."""
    totals = [row.get("total") for row in rows]
    return None if any(value is None for value in totals) else sum(totals)


def cache_read_cost(rows):
    """What the rows' cache reads cost at each row's own recorded rate."""
    if not rows or any(row.get("price_per_million_cache_read") is None for row in rows if row_counters(row)["cache_read"]):
        return None
    return sum(row_counters(row)["cache_read"] * (row.get("price_per_million_cache_read") or 0) / 1e6 for row in rows)


def model_label(model, opener):
    return OPENER_LABEL if opener else model


def reconcile(export):
    """Calls, rows and totals for the viewer and the markdown; see the module
    docstring for the rules. Returns None when there is nothing to show."""
    spans = (export.get("spans") or {}).get("model_calls") or []
    usage = export.get("usage")
    if not spans and not usage:
        return None
    turns = markdown_export.parse(export["frames"], (export.get("spans") or {}).get("tools"))

    calls = []
    warm = set()
    for index, call in enumerate(spans):
        tokens = counters(call)
        calls.append({
            "index": index, "model": call.get("model"),
            "tokens": tokens, "context": context(tokens) if tokens else None,
            "turn": turn_of(turns, call["start_ms"] / 1000), "end_ms": call["end_ms"],
            "opener": is_opener(call, tokens), "cache_miss": is_cache_miss(call, tokens, call.get("model") in warm),
            "status": "no usage" if tokens is None else "from telemetry", "row": None, "cost": None,
        })
        if tokens is not None:
            warm.add(call.get("model"))

    billed = [row for row in usage or [] if row.get("feature") == "agent_session"]
    side = [row for row in usage or [] if row.get("feature") != "agent_session"]
    ordered = sorted(billed, key=lambda row: timestamp_ms(row["created_at"]))
    claims = {}

    def unclaimed(row, turn):
        created_ms = timestamp_ms(row["created_at"])
        return sorted((
            call for call in calls
            if call["row"] is None and call["tokens"] is not None and call["model"] == bare_model(row["model"])
            and call["turn"] == turn and call["end_ms"] <= created_ms + ROW_AFTER_SPAN_MS
        ), key=lambda call: call["end_ms"])

    # Exact matches claim their spans first, in the containing turn and
    # then the one the row trails, so a row whose span is lost cannot take a
    # later row's own span; the rest take what is left in their likeliest turn.
    for row in ordered:
        for turn in row_turns(turns, timestamp_ms(row["created_at"]) / 1000):
            run = matching_run(unclaimed(row, turn), row_counters(row), timestamp_ms(row["created_at"]))
            if run:
                claims[row["id"]] = (turn, run, "matched")
                for call in run:
                    call["row"] = row["id"]
                break
    for row in ordered:
        if row["id"] not in claims:
            turn = next(iter(row_turns(turns, timestamp_ms(row["created_at"]) / 1000)), None)
            spans_left = unclaimed(row, turn)
            claims[row["id"]] = (turn, spans_left, "partial" if spans_left else "billed, no span")
            for call in spans_left:
                call["row"] = row["id"]

    rows = []
    for row in ordered:
        turn, claimed, status = claims[row["id"]]
        model, expected = bare_model(row["model"]), row_counters(row)
        for call in claimed:
            call["status"] = status
        if status == "matched" and len(claimed) == 1:
            claimed[0]["cost"] = row.get("total")
        reasoning = expected["output"] - total(call["tokens"] for call in claimed)["output"] if status == "matched" else 0
        rows.append({
            "id": row["id"], "model": model, "price_key": row["model"], "turn": turn, "tokens": expected,
            "total": row.get("total"), "status": status, "calls": [call["index"] for call in claimed],
            "reasoning_not_in_spans": reasoning,
            "opener": model == OPENER_MODEL and expected["output"] <= OPENER_MAX_OUTPUT
            and all(call["opener"] for call in claimed),
        })
    if usage is not None:
        for call in calls:
            if call["row"] is None and call["tokens"] is not None:
                call["status"] = "not billed"

    source = "ai_usage" if usage else "telemetry"
    return {
        "source": source,
        "calls": calls,
        "rows": rows,
        "models": models(calls, rows, billed, source),
        "side": side_calls(side),
        "coverage": coverage(calls, rows, side, usage is not None),
        "turns": [turn_totals(turn.number, calls, rows, billed, source) for turn in turns],
        "cost": cost(usage) if usage else None,
        "agent_cost": cost(billed) if usage else None,
    }


def models(calls, rows, billed, source):
    out = []
    for model in sorted({call["model"] for call in calls} | {row["model"] for row in rows},
                        key=lambda name: str(name)):
        model_calls = [call for call in calls if call["model"] == model]
        model_rows = [row for row in rows if row["model"] == model]
        model_billed = [row for row in billed if bare_model(row["model"]) == model]
        contexts = [call["context"] for call in model_calls if call["context"] is not None]
        reported = [call for call in model_calls if call["tokens"]]
        opener = (bool(reported) and all(call["opener"] for call in reported)) or (
            bool(model_rows) and all(row["opener"] for row in model_rows))
        tokens = total(row["tokens"] for row in model_rows) if source == "ai_usage" else total(
            call["tokens"] for call in model_calls if call["tokens"])
        misses = [call for call in model_calls if call["cache_miss"]]
        out.append({
            "model": model, "label": model_label(model, opener),
            "pricing": sorted({pricing(row["price_key"]) for row in model_rows} - {None}),
            "rows": len(model_rows), "spans": len(model_calls), "tokens": tokens,
            "cost": cost(model_billed) if source == "ai_usage" else None,
            "cache_read_cost": cache_read_cost(model_billed) if source == "ai_usage" else None,
            "contexts": contexts,
            "context_avg": round(sum(contexts) / len(contexts)) if contexts else None,
            "context_first": contexts[0] if contexts else None,
            "context_max": max(contexts) if contexts else None,
            "cache_misses": len(misses),
            "cache_miss_cost": cost_of_calls(misses),
        })
    return out


def cost_of_calls(calls):
    known = [call["cost"] for call in calls]
    return None if not known or any(value is None for value in known) else sum(known)


def side_calls(side):
    out = {}
    for row in side:
        entry = out.setdefault(row.get("feature"), {"rows": 0, "rows_priced": [], "models": set()})
        entry["rows"] += 1
        entry["rows_priced"].append(row)
        entry["models"].add(row.get("model"))
    return [
        {"feature": feature, "rows": entry["rows"], "cost": cost(entry["rows_priced"]), "models": sorted(entry["models"])}
        for feature, entry in sorted(out.items(), key=lambda item: -item[1]["rows"])
    ]


def coverage(calls, rows, side, have_usage):
    return {
        "have_usage": have_usage,
        "billed": len(rows),
        "matched": sum(1 for row in rows if row["status"] == "matched"),
        "partial": sum(1 for row in rows if row["status"] == "partial"),
        "billed_no_span": sum(1 for row in rows if row["status"] == "billed, no span"),
        "spans": len(calls),
        "spans_no_usage": sum(1 for call in calls if call["tokens"] is None),
        "spans_not_billed": sum(1 for call in calls if call["status"] == "not billed"),
        "side": len(side),
    }


def turn_totals(number, calls, rows, billed, source):
    turn_calls = [call for call in calls if call["turn"] == number]
    turn_rows = [row for row in rows if row["turn"] == number]
    mix = {}
    for call in turn_calls:
        label = model_label(call["model"], call["opener"])
        mix[label] = mix.get(label, 0) + 1
    unspanned = {}
    for row in turn_rows:
        if not row["calls"]:
            label = model_label(row["model"], row["opener"])
            unspanned[label] = unspanned.get(label, 0) + 1
    ids = {row["id"] for row in turn_rows}
    return {
        "turn": number,
        "mix": [{"label": label, "calls": count} for label, count in mix.items()],
        "billed_without_span": [{"label": label, "rows": count} for label, count in unspanned.items()],
        "tokens": total(row["tokens"] for row in turn_rows) if source == "ai_usage" else total(
            call["tokens"] for call in turn_calls if call["tokens"]),
        "cost": cost([row for row in billed if row["id"] in ids]) if source == "ai_usage" and turn_rows else None,
        "contexts": [call["context"] for call in turn_calls if call["context"] is not None and not call["opener"]],
        "cache_misses": sum(1 for call in turn_calls if call["cache_miss"]),
    }


def frame_rounds(export):
    """For each frame that starts a step (thought, message or tool call), the
    index of the model call whose span it was streamed in, else None."""
    spans = (export.get("spans") or {}).get("model_calls") or []
    out = []
    for frame in export["frames"]:
        update = ((frame.get("content") or {}).get("params") or {}).get("update") or {}
        if update.get("sessionUpdate") not in STEP_UPDATES:
            out.append(None)
            continue
        t = timestamp_ms(frame["t"])
        found = [
            index for index, call in enumerate(spans)
            if call["start_ms"] <= t <= call["end_ms"] + FRAME_AFTER_ROUND_MS
        ]
        # Rounds of one turn don't overlap, but the opener races the turn's
        # first round: it writes only message text, and nothing else.
        message = update["sessionUpdate"] == "agent_message_chunk"
        preferred = [index for index in found if is_opener(spans[index], counters(spans[index])) == message]
        owners = preferred or ([] if found and not message else found)
        out.append(max(owners, key=lambda index: spans[index]["start_ms"]) if owners else None)
    return out
