#!/usr/bin/env python3
"""Buy -> computer running -> macrod connected -> first agent reply, through a
local stack's real control plane (whatever fleet the stack's harness drives).

    e2e.py --stack <instance> --token-file <file> --runs 20 --out <dir> --label firecracker \
        --control-plane <name> --host-cmd 'ssh <host>'

Per run (one JSON line in <out>/e2e-<label>.jsonl, devbox epoch seconds):
  t_buy           POST /team/computers sent
  t_bought        its response
  t_<status>      first poll (every POLL s) that saw each ComputerStatus.status
  t_connected     first poll with harnessId set (macrod's first connection)
  t_prompt        first POST /agent-sessions to the computer's default agent
  t_session       the attempt (prompt_attempts, 5 s apart) whose session opened
  t_reply         first poll of the folded log holding agent text
  t_released      release answered
  trace           computer.setup span tree from Tempo (start/end in epoch s)
  host_computer   the Firecracker host agent's computer JSON (lastLaunch phases)
  clock_offset    host clock minus this machine's clock
  client_load     /proc/loadavg where e2e.py runs (not the control plane's)

With --agent it invites an agent teammate instead (see agent_run). Against a
deployed environment, pass the service URLs instead of --stack (--auth-url
and --storage-url with --agent, --auth-url and --harness-url without);
--host-cmd and Tempo are optional with --agent (spans are skipped without
--stack unless --tempo-url is given; the span window is this machine's clock,
so a skewed server can drop spans at its edges). Its t_*_created fields are
the server's clock, not this machine's.
"""

import argparse
import datetime
import json
import os
import pathlib
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parent.parent
POLL = 0.2
PROMPT_RETRY = 5


class Api:
    def __init__(self, base: str, token: str):
        self.base = base.rstrip("/")
        self.token = token

    def call(self, method: str, path: str, body=None, ok=(200, 201, 202, 204), timeout=120):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            self.base + path,
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read().decode(errors="replace")
            if error.code in ok:
                return error.code, None
            raise RuntimeError(f"{method} {path} -> {error.code}: {raw[:500]}") from None


def host_port(instance: str, service: str, container_port: str) -> int:
    """The host port Docker publishes a stack service's container port on."""
    out = subprocess.run(
        ["docker", "port", f"macro-{instance}-{service}-1", container_port],
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return int(out.splitlines()[0].rsplit(":", 1)[1])


HOST_CMD = ["false"]


def host(cmd: str) -> str:
    """Run a shell command on the fleet's host (--host-cmd prefix + cmd)."""
    return subprocess.run([*HOST_CMD, cmd], check=True, capture_output=True, text=True).stdout


def clock_offset() -> float:
    """Host clock minus devbox clock, from the midpoint of one ssh round trip."""
    best = None
    for _ in range(5):
        before = time.time()
        remote = float(host("date +%s.%N"))
        after = time.time()
        sample = (after - before, remote - (before + after) / 2)
        best = sample if best is None or sample[0] < best[0] else best
    return best[1]


def tempo_setup_trace(tempo: str, computer_id: str) -> list:
    """Every span of the computer's setup trace, flattened."""
    query = urllib.parse.quote(f'{{ name = "computer.setup" && span.computer_id = "{computer_id}" }}')
    with urllib.request.urlopen(f"{tempo}/api/search?q={query}&limit=5", timeout=10) as response:
        traces = json.load(response).get("traces", [])
    if not traces:
        return []
    trace_id = traces[0]["traceID"]
    with urllib.request.urlopen(f"{tempo}/api/v2/traces/{trace_id}", timeout=10) as response:
        trace = json.load(response)
    spans = []
    for batch in trace.get("trace", trace).get("resourceSpans", []):
        service = next(
            (a["value"].get("stringValue") for a in batch["resource"]["attributes"] if a["key"] == "service.name"),
            None,
        )
        for scope in batch.get("scopeSpans", []):
            for span in scope.get("spans", []):
                spans.append(
                    {
                        "service": service,
                        "name": span["name"],
                        "start": int(span["startTimeUnixNano"]) / 1e9,
                        "end": int(span["endTimeUnixNano"]) / 1e9,
                    }
                )
    return sorted(spans, key=lambda span: span["start"])


def agent_reply(folded):
    """postedAt of the first agent message with text, or None."""
    for message in (folded or {}).get("messages", []):
        if (message.get("author") or {}).get("kind") != "agent":
            continue
        if any(part.get("kind") == "text" and part.get("text") for part in message.get("parts", [])):
            return message.get("postedAt") or "unknown"
    return None


def one_run(args, auth: Api, harness: Api, tempo: str, run: int) -> dict:
    record = {"label": args.label, "run": run}
    status_seen = {}
    record["t_buy"] = time.time()
    record["name"] = f"bench {args.label} {run}"
    _, bought = auth.call(
        "POST",
        "/team/computers",
        {"purchaseKey": str(uuid.uuid4()), "size": args.size, "name": record["name"]},
    )
    record["t_bought"] = time.time()
    computer_id = bought["computerId"]
    record["computer_id"] = computer_id
    deadline = time.time() + args.timeout
    computer = None
    try:
        while time.time() < deadline:
            _, computers = auth.call("GET", "/team/computers")
            computer = next((c for c in computers if c["id"] == computer_id), None)
            now = time.time()
            if computer:
                status_seen.setdefault(computer["status"], now)
                if computer.get("harnessId") and computer.get("defaultAgentId"):
                    record["t_connected"] = now
                    break
                if computer["status"] == "failed":
                    raise RuntimeError(f"computer failed: {computer.get('failureReason')}")
            time.sleep(POLL)
        record.update({f"t_{status}": t for status, t in status_seen.items()})
        if "t_connected" not in record:
            raise RuntimeError("macrod never connected")
        # The host agent's own view: lastLaunch carries its per-phase
        # timings (ms), and restorePending is false once macro-restore ran,
        # which is when macrod-enroll starts.
        record["host_computer"] = json.loads(host(f"{args.host_cli} get {computer_id}"))
        record["agent_version"] = json.loads(host(f"{args.host_cli} host")).get("agentVersion")
        # macrod opens its trigger stream only once an agent is bound (it
        # polls every 10 s), so a request sent at "connected" can be lost and
        # the server then waits minutes for a session nobody opens. Resend
        # as a person would, every PROMPT_RETRY s, until one session opens.
        record["t_prompt"] = time.time()
        record["prompt_attempts"] = 0
        session = None
        while session is None and time.time() < deadline:
            record["prompt_attempts"] += 1
            try:
                _, session = harness.call(
                    "POST",
                    "/agent-sessions",
                    {"botId": computer["defaultAgentId"], "prompt": args.prompt},
                    timeout=PROMPT_RETRY,
                )
            except (TimeoutError, urllib.error.URLError) as error:
                if isinstance(error, TimeoutError) or isinstance(getattr(error, "reason", None), TimeoutError):
                    continue
                raise
        if session is None:
            raise RuntimeError("no session opened")
        record["t_session"] = time.time()
        record["first_prompt_lost"] = record["prompt_attempts"] > 1
        session_id = session["session"]["id"]
        record["session_id"] = session_id
        while time.time() < deadline:
            _, folded = harness.call("GET", f"/agent-sessions/{session_id}/log/folded")
            posted = agent_reply(folded)
            if posted:
                record["t_reply"] = time.time()
                record["reply_posted_at"] = posted
                break
            time.sleep(POLL)
        if "t_reply" not in record:
            raise RuntimeError("no agent reply")
    except Exception as error:  # recorded, the run still cleans up
        record["error"] = str(error)
    finally:
        # Wait spans are exported when the next milestone lands; give the
        # collector a few seconds to have the connection milestone.
        for _ in range(15):
            try:
                record["trace"] = tempo_setup_trace(tempo, computer_id)
                record.pop("trace_error", None)
            except Exception as error:
                record["trace_error"] = str(error)
            if (
                any(span["name"] == "computer.macrod.connected" for span in record.get("trace", []))
                or "t_connected" not in record
            ):
                break
            time.sleep(2)
        if not args.keep:
            try:
                auth.call("POST", f"/team/computers/{computer_id}/release", {"confirmName": record["name"]})
                record["t_released"] = time.time()
            except (RuntimeError, OSError) as error:
                # A purchase still confirming cannot be released yet; the
                # run is recorded and the next one goes ahead.
                record["release_error"] = str(error)
    return record


AGENT_SPANS = (
    "computer.setup.create",
    "computer.macrod.connected",
    "computer.agent.deliver",
    "computers.agent_enrollment.issue",
    "issue_agent_enrollment_handler",
    "agent_online_handler",
)


def first_spans(tempo: str, names: tuple[str, ...], start: float, end: float, settle: float = 60) -> dict:
    """The first span of each name that started inside [start, end], as epoch seconds.
    Tempo indexes spans some seconds after they end, so this asks again until
    every name is found or `settle` seconds pass."""
    deadline = time.time() + settle
    while True:
        out = spans_once(tempo, names, start, end)
        if len(out) == len(names) or time.time() > deadline:
            return out
        time.sleep(5)


def spans_once(tempo: str, names: tuple[str, ...], start: float, end: float) -> dict:
    out = {}
    for name in names:
        query = urllib.parse.quote(f'{{ name = "{name}" }}')
        url = f"{tempo}/api/search?q={query}&limit=20&start={int(start) - 1}&end={int(end) + 1}"
        with urllib.request.urlopen(url, timeout=10) as response:
            traces = json.load(response).get("traces", [])
        found = []
        for trace in traces:
            for span_set in trace.get("spanSets", [trace.get("spanSet") or {}]):
                for span in span_set.get("spans", []):
                    begin = int(span["startTimeUnixNano"]) / 1e9
                    if start <= begin <= end:
                        found.append((begin, begin + int(span["durationNanos"]) / 1e9))
        if found:
            begin, finish = min(found)
            out[name] = {"start": begin, "end": finish}
    return out


def messages_from(page, sender: str, after: float) -> list[dict]:
    """Messages by `sender` created after `after`, roots and thread previews alike."""
    return [message for message in channel_messages(page) if message["sender"] == sender and message["created"] > after]


def channel_messages(page) -> list[dict]:
    """Every message in a timeline page, with its created_at in epoch seconds (server clock)."""
    found = []

    def walk(value) -> None:
        if isinstance(value, dict):
            if value.get("sender_id") and value.get("content") and value.get("created_at"):
                created = datetime.datetime.fromisoformat(value["created_at"].replace("Z", "+00:00")).timestamp()
                found.append(
                    {"created": created, "content": value["content"], "id": value.get("id"), "sender": value["sender_id"]}
                )
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(page)
    return sorted(found, key=lambda message: message["created"])


def agent_run(args, auth: "Api", storage: "Api", run: int) -> dict:
    """Invite an agent teammate (which buys its computer), wait for it to come
    online and greet its inviter in the DM, prompt it there, wait for the reply,
    then remove it (which releases the computer)."""
    record = {"label": args.label, "run": run, "mode": "agent"}
    deadline = time.time() + args.timeout
    agent_id = None
    try:
        record["t_buy"] = time.time()
        _, agent = auth.call(
            "POST",
            "/team_agents",
            {
                "purchaseKey": str(uuid.uuid4()),
                "name": f"Bench {run}",
                "jobDescription": "",
                "personality": "",
                "size": args.size,
            },
        )
        record["t_invited"] = time.time()
        agent_id = agent["userId"]
        record["agent_user_id"] = agent_id
        record["computer_id"] = agent.get("computerId")
        while time.time() < deadline:
            _, listing = auth.call("GET", "/team_agents")
            mine = next((a for a in listing["agents"] if a["userId"] == agent_id), None)
            now = time.time()
            if mine:
                record.setdefault(f"t_agent_{mine['status']}", now)
                record["computer_id"] = record["computer_id"] or mine.get("computerId")
                if mine["status"] == "running":
                    break
                if mine["status"] in ("failed", "released"):
                    record["agent_final"] = mine
                    raise RuntimeError(f"agent {mine['status']}")
            time.sleep(POLL)
        if "t_agent_running" not in record:
            raise RuntimeError("agent never reported online")
        _, dm = storage.call("POST", "/channels/get_or_create_dm", {"recipient_id": agent_id})
        channel = dm["channel_id"]
        record["channel_id"] = channel
        timeline = f"/messages/channel/{channel}?selection=" + urllib.parse.quote(json.dumps({"limit": 20}))
        while time.time() < deadline:
            _, page = storage.call("GET", timeline)
            # The agent is new, so anything it sent is the greeting.
            greetings = messages_from(page, agent_id, 0)
            if greetings:
                record["t_greeting_seen"] = time.time()
                record["t_greeting_created"] = greetings[0]["created"]
                break
            time.sleep(POLL)
        if "t_greeting_seen" not in record:
            raise RuntimeError("no greeting in the DM")
        record["t_prompt"] = time.time()
        storage.call(
            "POST",
            f"/messages/channel/{channel}",
            {"content": args.prompt, "mentions": [], "attachments": [], "thread_id": None},
        )
        while time.time() < deadline:
            _, page = storage.call("GET", timeline)
            # After our prompt by server time, not this machine's clock, which may be skewed.
            prompts = [
                message
                for message in channel_messages(page)
                if message["sender"] != agent_id and message["content"] == args.prompt
            ]
            if not prompts:
                time.sleep(POLL)
                continue
            record["t_prompt_created"] = prompts[0]["created"]
            replies = messages_from(page, agent_id, prompts[0]["created"])
            if replies:
                record["t_reply"] = time.time()
                record["t_reply_created"] = replies[0]["created"]
                record["reply"] = replies[0]["content"][:200]
                break
            time.sleep(POLL)
        if "t_prompt_created" not in record:
            raise RuntimeError("our prompt never showed up in the DM timeline")
        if "t_reply" not in record:
            raise RuntimeError("no reply in the DM")
    except Exception as error:  # recorded; the agent is still removed
        record["error"] = str(error)
    finally:
        try:
            if args.tempo_url != "none":
                record["spans"] = first_spans(args.tempo_url, AGENT_SPANS, record["t_buy"], time.time())
        except Exception as error:
            record["spans_error"] = str(error)
        if agent_id and not args.keep:
            # Retried: a dropped connection must not leave the computer running.
            for attempt in range(5):
                try:
                    auth.call("DELETE", f"/team_agents/{urllib.parse.quote(agent_id, safe='')}")
                    record["t_removed"] = time.time()
                    break
                except (RuntimeError, OSError) as error:
                    record["remove_error"] = str(error)
                    time.sleep(5)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack", help="local stack instance name; service URLs default from its portmap")
    parser.add_argument("--token-file", required=True)
    parser.add_argument("--auth-url", help="authentication_service base; default from portmap")
    parser.add_argument("--harness-url", help="agent_harness_service base; default from portmap")
    parser.add_argument(
        "--tempo-url",
        help="default http://localhost:3200 with --stack, else none; 'none' skips span lookups (--agent only)",
    )
    parser.add_argument("--runs", type=int, default=1)
    parser.add_argument("--size", default="standard")
    parser.add_argument("--label", required=True)
    parser.add_argument("--prompt", default="Reply with exactly one word: pong")
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--gap", type=float, default=20, help="seconds between runs (release settles)")
    parser.add_argument(
        "--control-plane", required=True, help="where the stack runs, recorded with every result (e.g. devbox)"
    )
    parser.add_argument(
        "--host-cli",
        default=os.environ.get("FIRECRACKER_HOST_CLI", "firecracker-host client"),
        help="the Firecracker host agent's client command on the host (FIRECRACKER_HOST_CLI)",
    )
    parser.add_argument("--keep", action="store_true", help="do not release (debugging)")
    parser.add_argument(
        "--agent",
        action="store_true",
        help="invite an agent teammate instead of buying a computer: online, DM greeting, reply",
    )
    parser.add_argument("--storage-url", help="document_storage_service base, for --agent's DM; default from portmap")
    parser.add_argument("--out", required=True)
    parser.add_argument(
        "--host-cmd",
        help="command that runs its argument on the fleet host, e.g. 'ssh bench'; optional with --agent",
    )
    args = parser.parse_args()
    if not args.host_cmd and not args.agent:
        parser.error("--host-cmd is required without --agent")
    if not args.tempo_url:
        args.tempo_url = "http://localhost:3200" if args.stack else "none"
    if args.tempo_url == "none" and not args.agent:
        parser.error("a computer run needs Tempo: pass --tempo-url")
    if not args.stack:
        needed = ["--auth-url", "--storage-url"] if args.agent else ["--auth-url", "--harness-url"]
        missing = [flag for flag in needed if not getattr(args, flag[2:].replace("-", "_"))]
        if missing:
            parser.error(f"pass --stack, or {' and '.join(missing)}")
    if args.host_cmd:
        HOST_CMD[:] = args.host_cmd.split()

    def host_load() -> list[str] | None:
        return host("cat /proc/loadavg").split()[:3] if args.host_cmd else None

    token = pathlib.Path(args.token_file).read_text().strip()
    auth = Api(
        args.auth_url or f"http://localhost:{host_port(args.stack, 'authentication-service', '8080/tcp')}", token
    )
    def service(url: str | None, name: str) -> "Api":
        return Api(url or f"http://localhost:{host_port(args.stack, name, '8080/tcp')}", token)

    if args.agent:
        storage = service(args.storage_url, "document_storage_service")
    else:
        harness = service(args.harness_url, "agent_harness_service")
    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    with (out / f"e2e-{args.label}.jsonl").open("a") as file:
        for run in range(1, args.runs + 1):
            load_before = host_load()
            if args.agent:
                record = agent_run(args, auth, storage, run)
            else:
                record = one_run(args, auth, harness, args.tempo_url, run)
            record["host_load_before"] = load_before
            record["host_load_after"] = host_load()
            record["control_plane"] = args.control_plane
            record["client_load"] = open("/proc/loadavg").read().split()[:3]
            record["clock_offset"] = clock_offset() if args.host_cmd else None
            file.write(json.dumps(record) + "\n")
            file.flush()
            summary = {
                k: round(v - record["t_buy"], 2)
                for k, v in record.items()
                if k.startswith("t_") and not k.endswith("_created")
            }
            print(run, record.get("error", "ok"), summary, flush=True)
            time.sleep(args.gap)


if __name__ == "__main__":
    main()
