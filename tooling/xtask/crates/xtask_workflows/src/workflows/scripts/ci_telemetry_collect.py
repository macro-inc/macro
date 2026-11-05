"""Turn one completed workflow run into CI telemetry events, as an OTLP logs file.

Runs in the privileged exporter without the ingestion token. Everything here is
best effort: an error becomes a warning, and the observed workflow is never
affected. Events carry ids, names of our own jobs and steps, and timings, never
branch names, actors, titles or file paths.
"""

import datetime
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

API = "https://api.github.com"
PR_EVENTS = {"pull_request", "pull_request_target"}
# Runs after a PR closes, so it is never part of waiting for checks.
NOT_A_CHECK = {"Cleanup Preview"}
# Experiment branches stay queryable but are flagged out of the real PR numbers.
EXPERIMENT_BRANCH = re.compile(r"^[^/]+/ci-")
# A warm volume restores the dev shell in about 4 s, an empty one takes 110 s or more.
DEV_SHELL_STEP = "Setup Nix dev shell"
COLD_VOLUME_SECONDS = 30
# A start this long after the push was not caused by it: a reopen or leaving draft.
MAX_PUSH_LAG_SECONDS = 600
# Below this a step is noise, and it stays visible in the trace.
MIN_STEP_SECONDS = 1
# Stop before the exporter's own traces start failing for lack of API budget.
MIN_RATE_REMAINING = 100
MAX_FILE_PAGES = 3
# Roll-up jobs finish last by design, so they never say what held a push up.
ROLL_UP_JOB = re.compile(r"status[ -]check", re.IGNORECASE)
# Loki refuses a line this far behind its stream's newest one.
MAX_EVENT_AGE_SECONDS = 1800
SMALL_RUST_CRATES = 2
MEDIUM_RUST_CRATES = 9
WEB_SUFFIXES = (".ts", ".tsx", ".js", ".jsx", ".css", ".html", ".svelte")
RUST_ROOT_FILES = {"Cargo.toml", "Cargo.lock", "rust-toolchain.toml"}
CRATE_DIRECTORIES = {"src", "tests", "benches", "examples", "migrations"}


def parse_time(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def seconds(start, end):
    return int((end - start).total_seconds())


class Github:
    """Counts its own calls and stops before exhausting the shared token budget."""

    def __init__(self, repo, token):
        self.repo, self.token = repo, token
        self.calls = 0
        self.rate_limit = self.rate_remaining = None

    def get(self, path, **params):
        if self.rate_remaining is not None and self.rate_remaining < MIN_RATE_REMAINING:
            raise RuntimeError("GitHub API budget is low")
        query = f"?{urllib.parse.urlencode(params)}" if params else ""
        request = urllib.request.Request(
            f"{API}/repos/{self.repo}/{path}{query}",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
            },
        )
        self.calls += 1
        with urllib.request.urlopen(request, timeout=20) as response:
            self.rate_limit = int(response.headers.get("x-ratelimit-limit") or 0) or None
            self.rate_remaining = int(response.headers.get("x-ratelimit-remaining") or 0)
            return json.load(response)


def crate_root(parts):
    """The directory holding a crate's sources, which may be nested in a workspace."""
    for index, part in enumerate(parts[:-1]):
        if part in CRATE_DIRECTORIES:
            return "/".join(parts[:index])
    return "/".join(parts[:-1]) or parts[0]


def classify_files(paths):
    """Return (pr_type, rust_crates_changed) from the changed paths.

    Sizes count changed crates, because the workflow API can't see how many
    packages path-check selected.
    """
    crates, root_manifest = set(), False
    web = infra = False
    for path in paths:
        parts = path.split("/")
        if parts[0] in ("infra", ".github") or path.endswith(".nix"):
            infra = True
        elif path.endswith(".rs") or parts[0] in ("crates", ".sqlx") or parts[-1] in RUST_ROOT_FILES:
            if len(parts) == 1:
                root_manifest = True
            crates.add(crate_root(parts))
        elif parts[0] in ("apps", "packages") or path.endswith(WEB_SUFFIXES):
            web = True
        elif parts[0] == "tooling":
            infra = True
    rust = bool(crates)
    if rust and web:
        return "mixed", len(crates)
    if rust:
        if root_manifest or len(crates) > MEDIUM_RUST_CRATES:
            return "rust-large", len(crates)
        return ("rust-small" if len(crates) <= SMALL_RUST_CRATES else "rust-medium"), len(crates)
    if web:
        return "web", 0
    return ("infra" if infra else "other"), 0


def run_attributes(run):
    pull_requests = run.get("pull_requests") or []
    attributes = {
        "workflow": run["name"],
        "run_id": run["id"],
        "run_attempt": run["run_attempt"],
        "event_name": run["event"],
        "head_sha": run["head_sha"],
        "experiment": bool(EXPERIMENT_BRANCH.match(run.get("head_branch") or "")),
        "rerun": run["run_attempt"] > 1,
    }
    if pull_requests:
        attributes["pr_number"] = pull_requests[0]["number"]
    return attributes


def trace_ids(repo, run, suffix=None):
    """Reproduce gha-otel-export's ids, so an event links to its workflow trace."""
    prefix = f"{repo}{run['id']}{run['run_attempt']}"
    trace_id = hashlib.sha256(f"{prefix}t".encode()).hexdigest()[:32]
    span_id = hashlib.sha256(f"{prefix}{'s' if suffix is None else suffix}".encode()).hexdigest()
    return trace_id, span_id[16:32]


def timed(entry):
    """Started and finished, not skipped, and with times GitHub didn't copy from an old attempt."""
    start, end = parse_time(entry.get("started_at")), parse_time(entry.get("completed_at"))
    if entry.get("conclusion") == "skipped" or not start or not end or end < start:
        return None
    return start, end


def volume_state(job):
    for step in job.get("steps") or []:
        times = timed(step)
        if step["name"] == DEV_SHELL_STEP and times:
            return ("cold" if seconds(*times) >= COLD_VOLUME_SECONDS else "warm"), seconds(*times)
    return None, None


def queue_seconds(job, times):
    """None for a partial rerun's copied job, which starts before it was created."""
    created = parse_time(job.get("created_at"))
    if not created or times[0] < created:
        return None
    return seconds(created, times[0])


def job_events(repo, run, jobs):
    """One event per job that ran, and one per step long enough to matter."""
    base = run_attributes(run)
    events = []
    for job in jobs:
        times = timed(job)
        if not times:
            continue
        labels = job.get("labels") or []
        attributes = {
            **base,
            "event": "job",
            "job": job["name"],
            "job_id": job["id"],
            "conclusion": job["conclusion"],
            "run_seconds": seconds(*times),
        }
        queue = queue_seconds(job, times)
        if queue is not None:
            attributes["queue_seconds"] = queue
        if labels:
            attributes["runner_profile"] = labels[0].split(";")[0]
        volume, dev_shell = volume_state(job)
        if volume:
            attributes["volume_state"] = volume
            attributes["dev_shell_seconds"] = dev_shell
        events.append(
            (f"job {job['id']} {run['run_attempt']}", times[1], attributes, trace_ids(repo, run, job["name"]))
        )
        for number, step in enumerate(job.get("steps") or []):
            step_times = timed(step)
            if not step_times or seconds(*step_times) < MIN_STEP_SECONDS:
                continue
            events.append(
                (
                    f"step {job['id']} {number} {run['run_attempt']}",
                    step_times[1],
                    {
                        **base,
                        "event": "step",
                        "job": job["name"],
                        "job_id": job["id"],
                        "step": step["name"],
                        "conclusion": step["conclusion"],
                        "run_seconds": seconds(*step_times),
                    },
                    trace_ids(repo, run, job["name"] + step["name"]),
                )
            )
    return events


def same_trigger_runs(runs, run):
    """The runs started together with this one, and how many such groups came before.

    A run that starts after everything on the head has finished wasn't part of that
    wait: it came from a PR edit, a label or leaving draft.
    """
    groups, group_end = [], None
    for candidate in sorted(runs, key=lambda entry: parse_time(entry["created_at"])):
        created = parse_time(candidate["created_at"])
        end = parse_time(candidate["updated_at"]) if candidate["status"] == "completed" else datetime.datetime.max.replace(tzinfo=datetime.timezone.utc)
        if groups and created <= group_end:
            groups[-1].append(candidate)
            group_end = max(group_end, end)
        else:
            groups.append([candidate])
            group_end = end
    for index, group in enumerate(groups):
        if any(candidate["id"] == run["id"] for candidate in group):
            return group, index
    return [], 0


def conclusion_of(runs):
    """A workflow's newest run decides, since a PR edit can correct an earlier failure."""
    newest = {}
    for run in sorted(runs, key=lambda entry: (parse_time(entry["created_at"]), entry["id"])):
        newest[run["name"]] = run
    conclusions = {run["conclusion"] for run in newest.values()}
    if conclusions & {"failure", "timed_out", "startup_failure"}:
        return "failure"
    return "cancelled" if "cancelled" in conclusions else "success"


def clock_start(first_created, pushed_at, pr_created_at):
    """When the wait began: the push, or opening the PR when that came later."""
    if not pushed_at:
        return first_created, "first_run"
    start = max(pushed_at, pr_created_at) if pr_created_at else pushed_at
    if start > first_created or seconds(start, first_created) > MAX_PUSH_LAG_SECONDS:
        return first_created, "first_run"
    return start, "push" if start == pushed_at else "pr_open"


def push_event(repo, run, runs, jobs_by_run, pushed_at, pull_request, files, repeat=0):
    """The whole push: start to last job, by PR type. None when no job ran.

    `repeat` counts earlier groups of runs on this head. Those later groups are not
    the push's wait, so they are flagged as reruns.
    """
    finished = []
    for candidate in runs:
        for job in jobs_by_run[candidate["id"]]:
            times = timed(job)
            if times:
                finished.append((times[1], times, job, candidate))
    if not finished:
        return None
    first_created = min(parse_time(candidate["created_at"]) for candidate in runs)
    pr_created_at = parse_time(pull_request["created_at"]) if pull_request else None
    start, start_source = clock_start(first_created, pushed_at, pr_created_at)
    end = max(entry[0] for entry in finished)
    work = [entry for entry in finished if not ROLL_UP_JOB.search(entry[2]["name"])] or finished
    _, last_times, last_job, last_run = max(work, key=lambda entry: entry[0])
    slowest = max(work, key=lambda entry: seconds(*entry[1]))
    queues = [q for q in (queue_seconds(job, times) for _, times, job, _ in finished) if q is not None]
    volumes = [volume_state(job)[0] for _, _, job, _ in finished]
    pr_type, rust_crates = classify_files(files) if files is not None else ("unknown", 0)
    attributes = {
        **run_attributes(run),
        "event": "push",
        "pr_type": pr_type,
        "rust_crates_changed": rust_crates,
        "conclusion": conclusion_of(runs),
        "wall_seconds": seconds(start, end),
        "wall_start": start_source,
        "start_lag_seconds": seconds(start, first_created),
        "last_workflow": last_run["name"],
        "last_job": last_job["name"],
        "last_job_seconds": seconds(*last_times),
        "slowest_job": slowest[2]["name"],
        "slowest_job_seconds": seconds(*slowest[1]),
        "queue_max_seconds": max(queues, default=0),
        "queue_total_seconds": sum(queues),
        "workflows": len(runs),
        "jobs": len(finished),
        "cold_volumes": volumes.count("cold"),
        "rerun": repeat > 0 or any(candidate["run_attempt"] > 1 for candidate in runs),
    }
    attributes.pop("workflow")
    attributes.pop("run_id")
    attributes.pop("run_attempt")
    if files is not None:
        attributes["files_changed"] = len(files)
    if pull_request:
        attributes["pr_draft"] = bool(pull_request.get("draft"))
    if (run.get("head_repository") or {}).get("fork"):
        attributes["fork"] = True
    attempts = sum(candidate["run_attempt"] for candidate in runs)
    # The body and time are the same from every exporter that sees the push finish,
    # so Loki drops the duplicates when two runs complete together.
    body = f"push {run['head_sha']} {repeat} {attempts}"
    return (body, end, attributes, trace_ids(repo, last_run, last_job["name"]))


def pushed_time(github, branch, head_sha):
    activity = github.get("activity", ref=f"refs/heads/{branch}", per_page=30)
    for entry in activity:
        if entry.get("after") == head_sha:
            return parse_time(entry["timestamp"])
    return None


def changed_files(github, number):
    paths = []
    for page in range(1, MAX_FILE_PAGES + 1):
        batch = github.get(f"pulls/{number}/files", per_page=100, page=page)
        paths += [entry["filename"] for entry in batch]
        if len(batch) < 100:
            break
    return paths


def collect_push(github, repo, run):
    """The push event once this completion is the last one, otherwise None."""
    if run["event"] not in PR_EVENTS:
        return None
    listing = github.get("actions/runs", head_sha=run["head_sha"], per_page=100)
    runs = [
        candidate
        for candidate in listing["workflow_runs"]
        if candidate["event"] in PR_EVENTS and candidate["name"] not in NOT_A_CHECK
    ]
    runs, repeat = same_trigger_runs(runs, run)
    if not runs or any(candidate["status"] != "completed" for candidate in runs):
        return None
    jobs_by_run = {}
    for candidate in runs:
        jobs_by_run[candidate["id"]] = (
            []
            if candidate["conclusion"] == "skipped"
            else github.get(
                f"actions/runs/{candidate['id']}/attempts/{candidate['run_attempt']}/jobs",
                per_page=100,
            )["jobs"]
        )
    number = ((run.get("pull_requests") or [{}])[0]).get("number")
    pull_request = github.get(f"pulls/{number}") if number else None
    files = changed_files(github, number) if number else None
    pushed_at = None
    if not (run.get("head_repository") or {}).get("fork") and run.get("head_branch"):
        pushed_at = pushed_time(github, run["head_branch"], run["head_sha"])
    return push_event(repo, run, runs, jobs_by_run, pushed_at, pull_request, files, repeat)


def otlp_value(value):
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    return {"stringValue": str(value)}


def to_otlp(events, now):
    """OTLP logs. A record's time is its event's, clamped to what Loki will accept."""
    oldest = now - datetime.timedelta(seconds=MAX_EVENT_AGE_SECONDS)
    records = []
    for body, at, attributes, (trace_id, span_id) in events:
        nanos = int(max(at, oldest).timestamp()) * 1_000_000_000
        records.append(
            {
                "timeUnixNano": str(nanos),
                "severityText": "INFO",
                "body": {"stringValue": body},
                "traceId": trace_id,
                "spanId": span_id,
                "attributes": [
                    {"key": key, "value": otlp_value(value)} for key, value in attributes.items()
                ],
            }
        )
    resource = [
        {"key": "service.name", "value": {"stringValue": "ci-telemetry"}},
        {"key": "deployment.environment", "value": {"stringValue": "ci"}},
    ]
    return {
        "resourceLogs": [
            {
                "resource": {"attributes": resource},
                "scopeLogs": [{"scope": {"name": "ci-telemetry"}, "logRecords": records}],
            }
        ]
    }


def collect(github, repo, run):
    events = []
    try:
        jobs = github.get(
            f"actions/runs/{run['id']}/attempts/{run['run_attempt']}/jobs", per_page=100
        )["jobs"]
        events += job_events(repo, run, jobs)
        push = collect_push(github, repo, run)
        if push:
            events.append(push)
    except Exception as error:
        # A partial export still helps. The class and status can't carry a token or a payload.
        print(f"::warning::CI telemetry partly collected: {type(error).__name__} {getattr(error, 'code', '')}")
    return events


def main():
    started = time.monotonic()
    repo = os.environ["GITHUB_REPOSITORY"]
    with open(os.environ["GITHUB_EVENT_PATH"], encoding="utf-8") as handle:
        run = json.load(handle)["workflow_run"]
    github = Github(repo, os.environ["GITHUB_TOKEN"])
    events = collect(github, repo, run)
    now = datetime.datetime.now(datetime.timezone.utc)
    counts = {
        "event": "export",
        **run_attributes(run),
        "events": len(events),
        "api_calls": github.calls,
        "collect_seconds": round(time.monotonic() - started),
    }
    if github.rate_remaining is not None:
        counts["rate_remaining"] = github.rate_remaining
    if github.rate_limit:
        counts["rate_limit"] = github.rate_limit
    events.append((f"export {run['id']} {run['run_attempt']}", now, counts, trace_ids(repo, run)))
    with open(os.environ["CI_TELEMETRY_EVENTS"], "w", encoding="utf-8") as handle:
        json.dump(to_otlp(events, now), handle)
    print(f"{len(events)} events, {github.calls} API calls")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"::warning::CI telemetry not collected: {type(error).__name__}")
    sys.exit(0)
