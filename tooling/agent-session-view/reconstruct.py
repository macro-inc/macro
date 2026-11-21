"""--reconstruct: the literal text of each turn's reproducible prompt parts.

Prompt text is in no log or span, so it is rebuilt from source: the commit
that served the turn is found, checked out (detached, under the cache
directory), and `asv_reconstruct.rs` is built there as an example of
`ai_tools`, so every string comes from that commit's own rendering code. Each
part is then checked against the span: the bytes and the SHA-256 prefix the
harness records per prompt section. A part that matches is "verified"; one
that does not is a "mismatch" and is shown as one; one with nothing to check
against is "unverified".

Parts that depend on the user or session (memory, session instructions) or
are built inline in a private function (the session note, the model id line,
the opener note) are not rebuilt: only their size is shown.

The commit: the span's ECS task family names the task definition; its
registration time falls inside the production deploy run that registered it
(whatever the run's conclusion), and that run's commit is the one that served
the turn. The lookups are read-only (`aws ecs describe-task-definition`, `gh
api` run and release listings). When no run matches, the newest release
deployed before the turn is used, labelled "inferred" with the reason.
"""
import datetime
import hashlib
import json
import os
import pathlib
import re
import shlex
import shutil
import subprocess

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[1]
CACHE = pathlib.Path.home() / ".cache" / "agent-session-view"
EXAMPLE = HERE / "asv_reconstruct.rs"
EXAMPLE_PATH = "crates/ai_tools/examples/asv_reconstruct.rs"
PROD_DEPLOY = "Deploy Production Release"
NOT_STARTED = {"queued", "pending", "waiting", "requested"}
# `select_documentation` records its bytes before closing the block.
SDK_CLOSE = "</macro_sdk>\n"
NOT_REBUILT = {
    "memory": "the owner's memory: per user",
    "session_instructions": "the session's own instructions: per session",
    "session_note": "built inline in a private function",
    "model_id": "built inline in a private function",
    "opener_note": "built inline in a private function",
    "unsectioned": "a prompt not built from named sections",
}
LABELS = {
    "preamble": "preamble",
    "macro_prompt": "macro prompt + area guides",
    "identity": "identity",
    "connected_integrations": "connected integrations",
    "sdk_docs": "<macro_sdk>",
}
AGENT_IDENTITY = re.compile(r'<you name="([^"]*)" handle="([^"]*)"')
SERVER = re.compile(r"^mcp__(.+?)__")


def short_hash(text):
    """The harness's section hash: the first 8 bytes of SHA-256, as hex."""
    return hashlib.sha256(text.encode()).digest()[:8].hex()


def check(name, text, span_bytes, span_hash, note=None):
    """A reconstructed part and how it compares with what the span recorded."""
    part = {"name": name, "label": LABELS.get(name, name), "text": text, "note": note,
            "span_bytes": span_bytes, "span_hash": span_hash}
    if text is None:
        part.update(status="not reconstructed", bytes=None, hash=None)
        return part
    part.update(bytes=len(text.encode()), hash=short_hash(text))
    if span_hash:
        part["status"] = "verified" if span_hash == part["hash"] else "mismatch"
    elif span_bytes is not None:
        part["status"] = "verified" if span_bytes == part["bytes"] else "mismatch"
        part["note"] = (note + "; " if note else "") + "bytes only: the span has no hash"
    else:
        part["status"] = "unverified"
    return part


def run_json(args):
    # In the repository, so `gh` resolves {owner}/{repo} from its remote.
    return json.loads(subprocess.run(args, check=True, capture_output=True, text=True, cwd=REPO).stdout)


def iso(timestamp):
    return datetime.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))


def production_deploys():
    """{"runs", "releases"}: the production deploy runs and the published
    releases, newest first, or {"unreadable": reason}. Runs of every
    conclusion are kept: one job failing (an unrelated worker, say) marks the
    whole run "failure" though the services deployed."""
    try:
        listing = run_json(["gh", "api", "repos/{owner}/{repo}/actions/runs?event=release&per_page=100"])
        runs = [run for run in listing["workflow_runs"] if run["name"] == PROD_DEPLOY]
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, TypeError) as error:
        return {"unreadable": f"production deploy runs not readable ({type(error).__name__})"}
    try:
        releases = run_json(["gh", "api", "repos/{owner}/{repo}/releases?per_page=100"])
        return {"runs": runs, "releases": [
            release for release in releases
            # A prerelease never triggers the deploy workflow.
            if not release["draft"] and not release["prerelease"] and release["published_at"]
        ]}
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, TypeError) as error:
        return {"runs": runs, "releases": [], "releases_unreadable": f"releases not readable ({type(error).__name__})"}


def outcome(run):
    return "" if run["conclusion"] == "success" else f"; the run concluded {run['conclusion'] or run['status']}"


def deploy_commit(task, turn_started, env, deploys):
    """{"sha", "exact", "reason"}: the commit that served a turn. `task` is
    its ECS task definition (`family:revision`), `deploys` what
    `production_deploys` returned."""
    if env == "dev":
        return closest_main(turn_started, "dev deploys every main push; the last main commit before the turn")
    if "unreadable" in deploys:
        return closest_main(turn_started, deploys["unreadable"])
    runs = deploys["runs"]
    if task:
        try:
            registered = iso(run_json([
                "aws", "ecs", "describe-task-definition", "--task-definition", task,
                "--query", "taskDefinition.registeredAt", "--output", "json",
            ]))
            for run in runs:
                if run["status"] in NOT_STARTED:
                    continue
                # A run still going has no end yet.
                ended = iso(run["updated_at"]) if run["status"] == "completed" else turn_started
                if iso(run["created_at"]) <= registered <= ended:
                    return {"sha": run["head_sha"], "exact": True,
                            "reason": f"{run['head_branch']}: its deploy registered task {task}{outcome(run)}"}
            reason = f"no production deploy run spans task {task}'s registration"
        except (OSError, subprocess.CalledProcessError, ValueError, AttributeError, TypeError) as error:
            reason = f"task definition {task} not readable ({type(error).__name__})"
    else:
        reason = "the spans name no ECS task definition"
    if "releases_unreadable" in deploys:
        reason += "; " + deploys["releases_unreadable"]
    return newest_release_before(turn_started, runs, deploys["releases"], reason)


def first_attempt_end(run):
    """A re-run moves the run's end; its first attempt deployed the services."""
    attempt = run_json(["gh", "api", f"repos/{{owner}}/{{repo}}/actions/runs/{run['id']}/attempts/1"])
    return iso(attempt["updated_at"])


def newest_release_before(turn_started, runs, releases, reason):
    """The newest release deployed before the turn: one whose deploy run (its
    first attempt, when re-run) finished before it, or, for a release with no
    run listed, one published before it. Releases are ordered by when they
    started deploying."""
    candidates = []
    for run in runs:
        rerun = run.get("run_attempt", 1) > 1
        if not rerun and (run["status"] != "completed"
                          or run["conclusion"] not in ("success", "failure", "cancelled", "timed_out")):
            continue
        try:
            deployed = first_attempt_end(run) if rerun else iso(run["updated_at"])
        except (OSError, subprocess.CalledProcessError, ValueError, KeyError, TypeError):
            continue
        attempt = " (first attempt)" if rerun else ""
        when = f"its deploy run{attempt} finished before the turn ({deployed:%Y-%m-%d %H:%M}Z)"
        candidates.append((iso(run["created_at"]), deployed, run["head_branch"], run, when))
    with_runs = {run["head_branch"] for run in runs}
    for release in releases:
        if release["tag_name"] not in with_runs:
            published = iso(release["published_at"])
            candidates.append((published, published, release["tag_name"], None,
                               f"published before the turn ({published:%Y-%m-%d %H:%M}Z; no deploy run listed)"))
    before = [candidate for candidate in candidates if candidate[1] <= turn_started]
    if not before:
        return closest_main(turn_started, reason + "; no production release before the turn listed")
    _, _, tag, run, when = max(before, key=lambda candidate: candidate[0])
    if run:
        sha, why = run["head_sha"], when + outcome(run)
    else:
        try:
            sha = run_json(["gh", "api", f"repos/{{owner}}/{{repo}}/commits/{tag}", "--jq", "{sha: .sha}"])["sha"]
        except (ValueError, KeyError, TypeError) as error:
            raise OSError(f"release {tag}'s commit not readable ({type(error).__name__})") from error
        why = when
    return {"sha": sha, "exact": False, "reason": f"{reason}; inferred: {tag}, the newest release {why}"}


def closest_main(turn_started, reason):
    sha = subprocess.run(
        ["git", "-C", str(REPO), "rev-list", "-1", f"--before={turn_started.isoformat()}", "origin/main"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return {"sha": sha, "exact": False, "reason": reason}


def checkout(sha):
    """A detached checkout of `sha` holding the reconstruction example."""
    path = CACHE / "src" / sha
    if not path.exists():
        has = subprocess.run(["git", "-C", str(REPO), "cat-file", "-e", f"{sha}^{{commit}}"], capture_output=True)
        if has.returncode != 0:
            subprocess.run(["git", "-C", str(REPO), "fetch", "-q", "origin", sha], check=True)
        path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "-C", str(REPO), "worktree", "add", "-q", "--detach", str(path), sha], check=True)
    (path / EXAMPLE_PATH).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(EXAMPLE, path / EXAMPLE_PATH)
    return path


def render(sha, request):
    """The example's output for `request` at `sha`, cached per sha and request."""
    payload = json.dumps(request, sort_keys=True)
    key = hashlib.sha256((EXAMPLE.read_text() + payload).encode()).hexdigest()[:16]
    cached = CACHE / "reconstruct" / sha / f"{key}.json"
    if cached.exists():
        return json.loads(cached.read_text())
    path = checkout(sha)
    # A wrapper such as a build-slot queue, from ASV_BUILD_WRAPPER.
    wrapper = shlex.split(os.environ.get("ASV_BUILD_WRAPPER", ""))
    # The SDK documentation is generated by the TypeScript SDK; the commit's
    # own Nix package builds it without a bun install in the checkout.
    assets = subprocess.run(
        [*wrapper, "nix", "build", "--no-link", "--print-out-paths", f"{path}#code-mode-assets"],
        capture_output=True, text=True,
    )
    if assets.returncode != 0:
        raise ReconstructionFailed(f"code-mode-assets did not build at {sha[:11]}: " + assets.stderr[-2000:])
    command = [
        # A target directory per commit: cargo names a workspace member's
        # artifacts by its path in the workspace and judges freshness by
        # mtime, so checkouts sharing one could reuse another commit's build.
        *wrapper, "env", "SQLX_OFFLINE=true", f"CARGO_TARGET_DIR={CACHE / 'target' / sha}",
        f"CODE_MODE_ASSETS_DIR={assets.stdout.strip().splitlines()[-1]}",
        "nix", "develop", str(path), "-c",
        "cargo", "run", "-q", "-p", "ai_tools", "--example", "asv_reconstruct",
    ]
    result = subprocess.run(command, input=payload, capture_output=True, text=True, cwd=path)
    if result.returncode != 0:
        raise ReconstructionFailed(f"the example did not build or run at {sha[:11]}: " + result.stderr[-2000:])
    output = json.loads(result.stdout)
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(output))
    return output


class ReconstructionFailed(Exception):
    pass


def identities(export):
    """Name and handle pairs that may have rendered the identity section, from
    the agent context of the session's first prompt: the context's handle can
    differ from the identity's (`macro-new` for `macro`), so its first word
    and the lowercased name are tried too; the span picks the one it saw."""
    for frame in export["frames"]:
        params = frame["content"].get("params") or {}
        for part in params.get("prompt") or []:
            for context in re.findall(r"<m-agent-context>(.*?)</m-agent-context>", part.get("text") or "", re.S):
                try:
                    text = json.loads(context).get("text") or ""
                except ValueError:
                    continue
                match = AGENT_IDENTITY.search(text)
                if match:
                    name, handle = match.group(1), match.group(2)
                    pairs = [(name, handle), (name, handle.split("-")[0]), (name, name.lower())]
                    return [{"name": name, "handle": handle} for name, handle in dict.fromkeys(pairs)]
    return []


def integration_candidates(spans):
    """Lists of connected app names that may have rendered the integrations
    section, from the MCP servers the session's tools came from; the span's
    hash picks the right one."""
    servers = []
    for offer in spans.get("tool_offers") or []:
        for name in offer["names"]:
            match = SERVER.match(name)
            if match and match.group(1) not in servers and not match.group(1).startswith("macro"):
                servers.append(match.group(1))
    return [servers, sorted(servers), sorted(servers, key=str.lower)] if servers else [[]]


def own_calls(turn, calls):
    """The turn's own model calls (a side call, such as the title, offers no tools)."""
    return [call for call in calls if turn.started <= call["start_ms"] / 1000 <= turn.bound and call.get("eager_tools")]


def attach(export, contexts, turns, env):
    """Add a "literal" entry to each turn context: each turn is rebuilt at
    the commit that served it, with one build per commit."""
    spans = export.get("spans") or {}
    calls = spans.get("model_calls") or []
    if not contexts:
        return
    deploys = production_deploys() if env != "dev" else {}
    commits, groups = {}, {}
    for context, turn in zip(contexts, turns):
        rows = own_calls(turn, calls) + ([context["documentation"]] if context["documentation"] else [])
        task = next((row.get("task_definition") for row in rows if row.get("task_definition")), None)
        started = datetime.datetime.fromtimestamp(turn.started, datetime.timezone.utc)
        # Turns served by one task share an exact match; an inferred commit
        # depends on each turn's own start time.
        commit = commits.get(task)
        if not commit or not commit["exact"]:
            try:
                commit = deploy_commit(task, started, env, deploys)
            except (OSError, subprocess.CalledProcessError) as error:
                context["literal"] = {"error": f"no commit to rebuild from: {error}"}
                continue
            if task:
                commits[task] = commit
        groups.setdefault(commit["sha"], []).append((context, turn, commit))

    candidates = integration_candidates(spans)
    for sha, members in groups.items():
        docs = [
            {"entities": context["documentation"]["entities"], "guidance": context["documentation"]["guidance"]}
            for context, _, _ in members if context["documentation"]
        ]
        request = {"docs": docs, "identities": identities(export), "integrations": candidates}
        try:
            output = render(sha, request)
        except (ReconstructionFailed, OSError, subprocess.CalledProcessError, ValueError) as error:
            for context, _, commit in members:
                context["literal"] = {"commit": commit, "error": str(error)}
            continue
        rendered_docs = iter(output["docs"])
        for context, turn, commit in members:
            mark(context, commit, parts(context, turn, calls, output, rendered_docs))


def mark(context, commit, found):
    """Attach a turn's rebuilt parts, and flag any that differ from the span."""
    context["literal"] = {"commit": commit, "parts": found}
    wrong = [part["label"] for part in found if part["status"] == "mismatch"]
    if wrong:
        context["flags"].insert(0, {
            "id": "reconstruction-mismatch", "level": "warn",
            "text": f"Rebuilt from source at {commit['sha'][:11]}, these differ from what the span recorded: "
                    + ", ".join(wrong),
        })


def texts(contexts):
    """Move every rebuilt text out of the contexts into one map by hash, so
    a part repeated in every turn is stored once; parts keep the hash."""
    found = {}
    for context in contexts:
        for part in (context.get("literal") or {}).get("parts") or []:
            text = part.pop("text", None)
            if text is not None:
                found[part["hash"]] = text
    return found


def inferred(name, texts, sizes, hashes, note):
    """A part rendered from inputs this tool had to infer: the candidate the
    span confirms, or, when none does, the first one marked unverified. A
    wrong guess at the inputs says nothing about the code, so it is not a
    mismatch. Without a hash, candidates of one size can't be told apart, so
    only a single matching text counts as verified."""
    texts = list(dict.fromkeys(text for text in texts if text is not None))
    parts = [check(name, text, sizes.get(name), hashes.get(name), note) for text in texts]
    matching = [part for part in parts if part["status"] == "verified"]
    if len(matching) == 1:
        return matching[0]
    part = matching[0] if matching else (parts[0] if parts else check(name, None, sizes.get(name), hashes.get(name), note))
    if part["status"] in ("verified", "mismatch"):
        part["status"] = "unverified"
        part["note"] = (
            f"{note}; {len(matching)} candidates match the span's size and it has no hash to choose by"
            if matching else f"{note}; none of {len(texts)} candidates matches the span"
        )
    return part


def parts(context, turn, calls, output, rendered_docs):
    """The turn's prompt parts, each rebuilt where it can be, and checked."""
    own = own_calls(turn, calls)
    last = own[-1] if own else {}
    sizes, hashes = last.get("prompt_bytes") or {}, last.get("prompt_hashes") or {}
    # With the span's sections known, only the sections it had are rebuilt.
    had = (lambda name: name in sizes) if sizes else (lambda name: True)
    found = []

    # A turn nobody watches (a routine draft) has no Macro prompt and a
    # preamble of its own, private to the harness.
    unseen = bool(sizes) and "preamble" in sizes and "macro_prompt" not in sizes
    if unseen:
        found.append({"name": "preamble", "label": "preamble", "text": None, "status": "not reconstructed",
                      "note": "an unseen turn's preamble: private to the harness", "span_bytes": sizes["preamble"],
                      "span_hash": hashes.get("preamble"), "bytes": None, "hash": None})
    elif had("preamble"):
        found.append(check("preamble", output["preamble"], sizes.get("preamble"), hashes.get("preamble")))

    if had("macro_prompt") and not unseen:
        # Turns whose docs bring their entities' guidance get the prompt
        # without it.
        routed = (context["documentation"] or {}).get("guidance") == "Selected"
        found.append(check(
            "macro_prompt", output["routed_macro_prompt" if routed else "macro_prompt"],
            sizes.get("macro_prompt"), hashes.get("macro_prompt"),
            "routed: selected entities bring their own guidance" if routed else "area guidance inline",
        ))

    if "identity" in sizes:
        found.append(inferred("identity", output["identities"], sizes, hashes,
                              "name and handle inferred from the session's agent context"))
    if "connected_integrations" in sizes:
        found.append(inferred("connected_integrations", output["integrations"], sizes, hashes,
                              "app names inferred from the session's MCP tools"))

    for name, why in NOT_REBUILT.items():
        if name in sizes:
            found.append({"name": name, "label": name, "text": None, "status": "not reconstructed",
                          "note": why, "span_bytes": sizes[name], "span_hash": hashes.get(name),
                          "bytes": None, "hash": None})

    if context["documentation"]:
        text = next(rendered_docs)
        part = check("sdk_docs", text, sizes.get("sdk_docs"), hashes.get("sdk_docs"))
        # The selection span's own count stops before the closing tag.
        selection_bytes = context["documentation"]["bytes"]
        if selection_bytes is not None and selection_bytes != len(text.encode()) - len(SDK_CLOSE):
            part["status"] = "mismatch"
            part["note"] = f"select_documentation recorded {selection_bytes:.0f} bytes"
        found.append(part)
    return found
