# routines-suggestions-climb

Worker in project `routines`. Hill-climb the `routines` section of the suggestions bench
(`crates/suggestion_generation/bench/`): quality up (first stop ≥ 50, then toward 100),
price down (first stop ≤ $5 a run of 27 attempts, then toward $2), feed not worse.

## Setup
- Worktree: ~/.herdr/worktrees/macro/synoet-routines-suggestions-climb, branch
  synoet/routines-suggestions-climb (reset onto origin/main 78cc5a01d0b on 2026-11-18).
- Own stack: instance `sugclimb`, started with
  `--env-file <scratch>/stack.env` (bench stack.env plus `CLOUDFLARE_API_TOKEN=`: local Doppler
  gives the token without the account id and the harness crash-loops). Never touch `sugbench`.
- Bench: `bun crates/suggestion_generation/bench/bench.ts ... --instance sugclimb`.
- Held-out set: `climb1` (ines, dele, rosa), made 2026-11-18 before any change, unread, 0 uses.
- Scratch: <session scratchpad, gone>

## Main on my stack (78cc5a01d0, 2026-11-18)
- routines: 11.4 (1.6–20.5), found 3.10/5.8, bad 2.43, 21.1 suggested; gen $0.214, judge
  $0.192 per attempt; 21/27 scored (6 delivery_unknown under machine load).
  run: ~/.cache/suggestions-bench/runs/main-routines-tune-2026-11-18T22-55-31-709Z/run.json
- feed: 72.8 (68.3–77.4); gen $0.182, judge $0.268.
  run: ~/.cache/suggestions-bench/runs/main-feed-tune-2026-11-18T23-47-36-932Z/run.json
- Cost anatomy: gemini-3.8-flash is $0.30/M in, $0.03/M cached, $1.20/M out; one ai_usage row
  per session (~107k uncached in, 684k cached, 16k out). Each of 3 sessions reads the whole mail.
  Judge (Opus 5.5): ~31k-token prompt written to cache every call (66% of judge cost), ~4k out.

## Ladder (kept / dropped)
- DROPPED judge-cache: persona context moved into the judge's system prompt so seats share a
  cached prefix. Rejudging main's run: 12.4 (old judge) vs 15.1 (new), invented 0.14 → 0.05,
  and cost rose in rejudge (all calls parallel, no hits). Moves the judge; not worth it now.
- KEPT prompt-v1 (2d93cf164b1): evidence-only brief, 3–6 in all, catalog first, at most two
  drafts, onboarding works from the mail only. Tune 49.7 (found 4.43, bad 1.65, 10.6 suggested),
  gen $0.260, judge $0.183, first 123 s. WIN +41.5 vs main.
- KEPT single session (9c5d70460f7): one routines session for every surface at onboarding.
  Tune 66.3 (found 3.81/5.7, bad 0.07, 4.9 suggested), gen $0.079, judge $0.180, first 139 s,
  27/27 scored. WIN +13.8 vs prompt-v1, +55.3 vs main.
- KEPT judge cache v1 (89b99eb6aa0): seats read as the first seat (asFirstSeat), shared text
  after the rubric in cached instructions, a round's seats wait for its first judgement.
  Same generations (compare): main old judge 11.0 and 12.3, new 12.3; single 66.3 → 64.7;
  judge $0.180 → $0.095. main→single still WIN +52.4.
- FIX held-out seeding (b9e9fd2ee52): addresses with accents (one climb1 person) refused by the
  seed CLI; persona files read with ASCII local parts. Tune personas read byte-identical.

## Held-out
- climb1 (SPENT 2026-11-19): branch b9e9fd2ee5 31.7 (24.1–39.3), found 2.30/5.3, bad 0.59, gen $0.075,
  judge $0.107; main (main product files, same bench) -83.7, found 1.30, bad 5.56. WIN +115.4.
  Branch under 50 on held-out (tune 64.7): aggregate only — held-out needs are 44% drafted-only
  (tune 23%), and 39 of 42 held-out drafts met no need. Tune drafts that met nothing all made one
  bare task that pasted the message instead of pulling out what the person must do.
- climb2 (made 2026-11-19, 3 personas): main baseline -40.7 (-61.1–-21.6), found 2.26/6.0, bad 4.70.
  One candidate use left.
- Fresh main tune (2026-11-19 04:13, new judge): 19.3 (8.3–30.2), found 3.37, bad 2.37, gen $0.219,
  judge $0.157. main → single WIN +45.4.


## Ladder, continued
- KEEP v2 brief (uncommitted, scratch v2/prompt.md): notices that leave something to do count;
  draft each stream the catalog lacks (≤3); drafts do the reading (facts, each next step its own
  task, Ask AI step). Tune 69.5 (61.5–77.4), found 3.96, bad 0.07, gen $0.072, judge $0.091,
  first 135 s. vs single NOISE +4.8, but drafts meeting no need 6/32 → 0/39, drafted-only needs
  found 19% → 33%.
- DROPPED v3 (v2 + catalog picks in a program of their own + "every stream"): first suggestion
  100 s (from 135 s) but 3/27 generations hit the 240 s onboarding timeout; 61.2, -8.3 vs v2
  (noise, interval -15.0 to -1.5), bad 0.07 → 0.26.
- DROPPED v4 (v2 + "every stream, most people have one to three"): 71.6, +2.1 vs v2 (noise), drafts
  per generation unchanged (1.41), first suggestion 152 s (v2 135 s).
- COMMITTED v2 as 38d2442170e.
- climb2 (SPENT): branch 38d2442170e 33.3 (26.5–40.7), found 2.70/6.0, bad 0.70, gen $0.075,
  judge $0.107 → $4.91 a run; main -40.7. WIN +74.1. Drafted-only needs found 32% (climb1 7%).
  Aggregate by key (spent sets, counts only): calendar needs found 0%; needs_reply needs mostly
  missed; archive_noise is a decoy in both held-out keys (17 picks), "fine" in tune keys.
- Feed on branch 38d2442170e: 77.4 (73.3–81.5) vs main 72.8, NOISE +4.5; bad 0.59 → 0.26. Not worse.
- climb2 33.3 < 50: first stop not met. Spent sets climb1/climb2 now used as aggregate-only dev sets
  (departure from brief, to disclose); fresh climb3 for the next confirmation.
- Tune reading: drafted-only needs found 33% on tune too (plumber reviews, sales e-signature +
  forecast). Sessions draft for streams a catalog routine covers (recaps, permits) and skip tool
  notices that need a step. Testing v5: notices judged by what the user does; archive only mail
  that never needs them; a catalog routine covers a stream when it gets the result, even if broader.
- v5 tune: 68.8 (60.5–76.7), NOISE -0.7 vs v2; email_tasks picked 27/27 (from 19), archive_noise 1
  (from 9), drafts 32 (from 39). Sessions now fold drafted-only streams into email_tasks ("even
  though it's broader"): sales forecast/e-sign, plumber reviews still missed.
- v5 on climb2 (dev, spent): 46.3 (39.5–52.5) vs v2 33.3, WIN +13.0; found 2.70 → 3.44; email_tasks
  needs 27/27; drafted-only found 38%; bad 0.67 (invoices misfit 9 on one persona, archive_noise
  4); 1/27 hit the 240 s timeout.
- testing v6 = v5 + catalog routine handles a stream only when its condition holds and it's all the
  user needs (not notices that leave a step, not facts gathered across messages) + a list of who's
  waiting over drafted replies.
- v6 tune: 74.4 (67.2–81.4), +4.9 vs v2 (noise); drafted-only needs found 31% → 64%; 1/27 timeout.
- v6 on climb2 (dev): 51.9 (44.4–59.3), +5.6 vs v5 (noise), +18.5 vs v2 (WIN); needs_reply needs
  18/18; drafts meeting nothing 23/51; bad 0.59.
- COMMITTED v6 as 06dd8b8d677. scheduled_action lib tests 575 passed.
- climb3 (made 2026-11-19 after v6, SPENT): main (base product files, verified binary) -45.7
  (-69.1–-23.5), found 1.81/5.3, bad 4.15, gen $0.229, judge $0.155; branch 06dd8b8d677 50.5
  (45.4–55.3), found 3.07/5.3, bad 0.37, gen $0.074, judge $0.101 → $4.73 a run. WIN +96.2.
  Aggregate: catalog-meetable needs found 97%, drafted-only 18%; drafts meeting nothing 30/43.
- FIRST STOP met (marginally: interval 45.4–55.3). suggestion_generation tests 73 passed,
  just check clean. Reviewer oneoff `routines-climb-review` reading the diff before the push.

## Review and PR (2026-11-19)
- Reviews: eight codex passes (routines-climb-review..review8), then CodeRabbit. Fixed: judge
  reads a seat as the first only when renaming changes nothing (`renamesExactly`); runs record
  `JUDGE` (now v4) and persona digests; compare/noise/joins refuse unrecorded or mixed judges and
  personas read two ways; rejudge refuses changed or undigested personas and leaves a file it
  can't fully judge; held-out spelling (apostrophes, brackets, collisions, empty parts) with
  `bench/personas.test.ts`; brief asks for mail triggers only with `enable-event-routines` and
  conditions (`RoutineBriefing::conditions`; events off on tune: 72.0, a look); weekly review wins.
- PR #11466 https://github.com/macro-inc/macro/pull/11466, ready for review, main merged
  (1dfbc8bcb72). Tests on 1dfbc8bcb72: scheduled_action lib 582, suggestion_generation 73,
  harness --tests check clean, just check clean. Bench tests 6 on 86469d6514a.
- Audit (routines-climb-audit): only env failures (Redis-less harness tests, pass in CI), the
  iOS CI flake (GitHub 500, rerun passed) and README "uncached" (fixed).
- No saved run has a recorded judge or digests: the next climb step needs main and the branch
  run again on tune before any compare.

## Leg 2 (2026-11-19): toward 100 and $2
- Manager: new branch on top, fresh baselines first, then the drafted-routine gap (held-out:
  drafted-only 18% found, 30/43 drafts meeting nothing), then price. Keep new wording general
  (the brief's notice examples sit close to tune's streams); confirm on a fresh set, never
  climb1-3. Report time to first suggestion as a third number; hand back catalog picks early
  without bringing back the padding.
- Branch `synoet/routines-suggestions-climb-2` (from 86469d6514a), same worktree and stack.
- dev1: a fresh set made to be READ (departure, disclosed): tune shows no drafted gap (its
  drafted-only needs are what v6's wording was written from), so the gap can only be studied on
  personas outside tune. climb4 (unread) will be made later for the confirmation.
- First-suggestion study on v6 tune: the catalog program comes after 3-11 tool calls (mostly
  SDK reads for drafting: RoutineOptions etc. in 27/27), 75-345 s after the prompt; the brief
  puts catalog and drafts behind one round of thinking. compose_agent_context 0.3-9.4 s locally.
- Chain chain-2b: dev1 make → rebuild HEAD → pr on dev1 → pr on tune → main on tune → rebuild HEAD.
- dev1 made (marisol vet practice manager, oskar arts nonprofit coordinator, priya immigration law
  partner). PR head (86469d6514a build) on dev1: 54.4 (49.5–59.3), found 3.33/5.7, bad 0.26,
  first 140 s, gen $0.074, judge $0.094. Catalog needs found 9/9 each except oskar r3
  reply_drafts 0/9. Drafted-only 9/63: only the claim-info-request task (marisol r4); never the
  daily schedule digest, compliance log, venue bookings on the calendar, weekly volunteer roll-up,
  prospects into the CRM, weekly receivables. Every draft made a task per message.
- PR head on tune (judge v4 + digests): 74.4 (66.7–82.0), found 4.30/5.7, bad 0.11, first 150 s,
  gen $0.076, judge $0.092 → $4.54. Tune misses: brief/meeting_brief 2/9 (founder, sales),
  invoices 4/9, pipeline 3/9, e-sign handoff 2/9, forecast 5/9.
- Spend (v6 tune): gen = gemini-3.8-flash per session 112k uncached in, 561k cached, 18.6k out;
  judge = opus 5.5, 9 rounds each writing a ~40k prefix ($5/M) = most of the judge's cost.
- Programs can't create calendar events (SDK: refused; agents propose them as review cards), so
  v7 doesn't point drafts at the calendar.
- v7 (uncommitted, testing): catalog routines in a program of their own before drafting; the
  catalog lacks notices leaving a step, messages adding up to one thing tracked, new clients or
  prospects to record, log entries (no tune-like examples); drafts make a task per step, a CRM
  company or contact for a new client or prospect, one task or document for what many messages
  add up to or a log, never a task per message; START_* say "handle what each message asks".
- v7 results (built on 86469d6514 + uncommitted brief): dev1 59.9 (+5.4 noise; found 3.74, bad
  0.41, first 82 s median vs 140 s), tune 66.9 (−7.5 noise; found 4.00, bad 0.26, first 80 s vs
  150 s). Gen $0.080/$0.077, judge $0.103/$0.097. Gains: priya prospects→CRM 9/9, marisol
  compliance log 4/9. Losses on tune: plumber reviews 9/9→0/9 and sales e-sign 4/9→1/9, both
  crowded out of the three draft slots by "record new leads/prospects in CRM" drafts (homeowners;
  a rep whose CRM already has them). Catalog-first program is what cut first-suggestion time.
- v8 (commit 2c2ab3da567): CRM only for a company that may become a client, unless another app of
  theirs already keeps track of them; drafts ranked by what they'd most regret missing; surfaces =
  where the user would look for what it makes. Running tune then dev1.
- Price notes: first generation call is ~75k tokens and never a cache hit; later calls sometimes
  miss half their prefix (implicit Gemini caching). Static part of each call ≈ macro prompt 65 KB
  + SDK docs 48 KB + 13 eager tools 73 KB. Judge: 9 prefix writes a run because each rep has its
  own `now`; one `now` per run and judging after all reps would make it 3 (≈ −$0.9/run).
- v8 tune: 67.4 (found 3.93, bad 0.15, first 79 s, gen $0.082, judge $0.095). CRM drafts gone;
  plumber reviews still 1/9, sales e-sign 0/9: the first leg's tune-like examples ("feedback
  posted that they answer, paperwork completed that they pass on") were what found those two on
  tune. Removing them per the manager's caution costs ~7 on tune; climb4 decides.
- 2026-11-19 18:4x: PR 11466 merged (squash). Merged origin/main into climb-2 (526a73934c9),
  keeping this branch's prompt.md, prompt.rs, bench README (main's were the leg-1 head's).
- Bench change committed (105fcd601dd): routines runs read mail at one `now` for all reps and
  judge after the last rep, so each persona's judge prefix is written once a run (3, not 9).
  Proof plan: main on tune twice under it → `noise` against MARGINS.
- Next chain (chain-5): main tune, main-b tune, main climb4, then candidate tune, candidate climb4.
- v8 dev1: 59.3 (found 3.70, bad 0.41, first 82 s, gen $0.077, judge $0.100). priya r4 CRM 9/9.
- v9 (commit bf31a3b4d73): the catalog-lacks sentence says why request routines miss
  step-leaving notices (in general terms) and names amounts/counts/statuses gathered across
  messages. Running on tune (19:13).
- 19:20: price lever found. A routines session was opened without instructions, so it ran as a
  conversation: full macro prompt, routed SDK docs, 13 eager tools, conversation effort. Branch
  synoet/routines-suggestions-unseen (459b4b230a3, on top of v9): the brief is split into
  instructions (task, guide, code steps, catalog: same for everyone) and a prompt (time,
  dismissals, apps, mail); the session is prepared with the instructions, so agent_inmem runs it
  unseen like a routine draft: short prompt, code-mode tools only, low effort, instructions in
  the cached shared prefix. Tests: scheduled_action suggestions 39 passed, suggestion_generation
  domain::service 27 passed.
- chain-7 (replaces chain-6 after its v9 tune): v9 tune → ff-merge unseen into climb-2 → unseen
  tune → main tune ×2 (files at merge-base, bench kept) → main climb4 → restore. The candidate's
  climb4 run waits until unseen is judged, so the held-out set confirms the final candidate.
- Correction: unseen sessions change effort only for models whose `ReasoningEffort::supported`
  lists low; gemini-3.8-flash lists none, so routines sessions keep their effort.
- v9 tune (bf31a3b4d7): 70.7 (64.4–76.9), found 4.00, bad 0.04, first 80 s, gen $0.080, judge
  $0.056 → $3.67 a run (first run under the once-a-run judge cache).
- unseen tune (b61f51d8c2): 67.4 (59.9–74.4), found 3.81, bad 0.04, first 83 s, gen $0.065,
  judge $0.054 → $3.22 a run. v9 → unseen NOISE −3.3; generation −19% (95% −0.021 to −0.008
  per attempt). pr (leg 1, now main) → unseen: found −0.48, just past its 0.47 margin (worse);
  pr → v9 NOISE −3.7. Leg 2 so far buys time to first (150 s → 80 s) and price, not quality.
- Unseen traces: 10–16 model calls a session; the first ExecuteCode at 50–87 s, after one
  ~50–70 s model call (the second); 66–115k uncached in, 384–734k cached.
- Commit abf81530a2a on the unseen branch (unbenched): the routines instructions carry the SDK
  reference for `suggest` and `check` (`RoutineBriefing::reference`), so a session reads no docs
  before its first program. Tests: scheduled_action suggestions 40, harness routine_code 15.

## Stopped for the machine move (2026-11-19 20:25)
- chain-7 stopped during "main tune" (partial run, not usable); main-b tune and main climb4
  never ran, so the bench judge-cache change (105fcd601dd) is still unproven against MARGINS
  and climb4 is still unspent. Stack sugclimb stopped (`just run_local stop`, data kept).
- Pushed: synoet/routines-suggestions-climb-2 (b61f51d8c25), synoet/routines-suggestions-unseen
  (abf81530a2a), handoff on synoet/routines-suggestions-climb-2-wip (handoff/HANDOFF.md).
- Held-out sets (climb4 unspent; dev1, climb1-3 spent) live only in this machine's
  ~/.cache/suggestions-bench/heldout and were not committed (unread by design): make fresh ones.
