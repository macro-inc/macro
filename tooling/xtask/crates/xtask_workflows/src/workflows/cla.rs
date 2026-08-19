//! `CLA` — enforces the Contributor License Agreement on PRs.
//!
//! Produces the required `cla` commit status. The check is a pure function of
//! (author identity, org membership, signature store): bots pass, macro-inc
//! org members pass (their CIIA assigns IP to CoParse Inc., superseding the
//! CLA), everyone else needs a signature on file with the signing worker
//! (`services/cla-worker`). No labels, no stored state; re-runs are
//! idempotent. If the worker is unreachable the check fails *closed* with an
//! infrastructure-error description.
//!
//! Two triggers:
//! - `pull_request_target` (opened / synchronize / reopened): set the status,
//!   silently — the bot never comments unprompted.
//! - `issue_comment` (created) on PRs: `/macro-cla` (org members only)
//!   posts the signing invitation; `/macro-cla check` (anyone) re-runs the
//!   check.
//!
//! `pull_request_target` runs with base-repo secrets on fork PRs, so this job
//! must never check out or execute PR head code — there is deliberately no
//! checkout step; it only reads event metadata and calls two APIs.

use gh_workflow::{
    Concurrency, Event, Expression, IssueComment, IssueCommentType, Job, Level, Permissions,
    PullRequestTarget, PullRequestType, Step, Use, Workflow,
};

use crate::workflows::runners;

/// Base URL of the signing worker (`services/cla-worker`). On workers.dev
/// like the account's other workers; if it ever moves to a vanity host,
/// update this constant, the OAuth app callback URL, CONTRIBUTING.md, and
/// the worker README together.
const WORKER_ORIGIN: &str = "https://macro-cla.macroverse.workers.dev";

/// Build the workflow.
pub fn cla() -> Workflow {
    Workflow::new("CLA")
        .on(Event::default()
            .pull_request_target(
                PullRequestTarget::default()
                    .add_type(PullRequestType::Opened)
                    .add_type(PullRequestType::Synchronize)
                    .add_type(PullRequestType::Reopened),
            )
            .issue_comment(IssueComment::default().add_type(IssueCommentType::Created)))
        // Serialize runs per PR so a burst of events can't interleave status
        // writes; never cancel — a dropped run could leave a stale status.
        .concurrency(
            Concurrency::new(Expression::new(
                "cla-${{ github.event.pull_request.number || github.event.issue.number }}",
            ))
            .cancel_in_progress(false),
        )
        .add_job("cla", cla_job())
}

fn cla_job() -> Job {
    Job::default()
        .name("CLA")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        // Skip non-PR comments and comments that can't be a command; the
        // command itself is exact-matched in the script.
        .cond(Expression::new(
            "github.event_name == 'pull_request_target' || \
             (github.event.issue.pull_request && startsWith(github.event.comment.body, '/macro-cla'))",
        ))
        // Least privilege for what the script actually calls: commit statuses
        // (write), PR comments and reactions — which are issue APIs even on a
        // PR (write), and `pulls.get` (read only).
        .permissions(Permissions {
            statuses: Some(Level::Write),
            pull_requests: Some(Level::Read),
            issues: Some(Level::Write),
            ..Default::default()
        })
        .add_step(cla_script())
}

fn cla_script() -> Step<Use> {
    Step::new("Run CLA check")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        // Org-membership probe. The default GITHUB_TOKEN only sees public org
        // members; set the CLA_ORG_READ_TOKEN secret (read:org PAT or app
        // token) so private members pass without signing.
        .add_env((
            "ORG_READ_TOKEN",
            "${{ secrets.CLA_ORG_READ_TOKEN || github.token }}",
        ))
        // Shared secret for the signing worker's /cla/check endpoint.
        .add_env(("CLA_CHECK_API_KEY", "${{ secrets.CLA_CHECK_API_KEY }}"))
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with(("script", script()))
}

/// The whole enforcement logic. Comment bodies are only ever read from the
/// runtime event payload (never template-interpolated), so untrusted text
/// cannot inject into this script.
fn script() -> String {
    indoc::formatdoc! {r#"
        const WORKER_ORIGIN = '{WORKER_ORIGIN}';
        const SIGN_URL = `${{WORKER_ORIGIN}}/cla`;
        const STATUS_CONTEXT = 'cla';
        const {{ owner, repo }} = context.repo;

        // GET /orgs/{{org}}/members/{{username}}: 204 → member, 404 → not a
        // member, 302 → the probing token itself lacks org visibility (treated
        // as not-a-member: fail closed). Anything else is an infra error.
        async function isOrgMember(username) {{
          const res = await fetch(
            `https://api.github.com/orgs/${{owner}}/members/${{encodeURIComponent(username)}}`,
            {{
              headers: {{
                authorization: `Bearer ${{process.env.ORG_READ_TOKEN}}`,
                accept: 'application/vnd.github+json',
                'user-agent': 'macro-cla-action',
                'x-github-api-version': '2022-11-28',
              }},
              redirect: 'manual',
            }},
          );
          if (res.status === 204) return true;
          if (res.status === 404 || res.status === 302) return false;
          throw new Error(`org membership probe for ${{username}} returned ${{res.status}}`);
        }}

        async function setStatus(sha, state, description) {{
          await github.rest.repos.createCommitStatus({{
            owner, repo, sha, state,
            context: STATUS_CONTEXT,
            description,
            target_url: SIGN_URL,
          }});
          core.info(`cla → ${{state}}: ${{description}}`);
        }}

        // The check is a pure function of (author, org membership, signature
        // store); nothing here reads or writes any other state.
        async function runCheck(pr) {{
          const author = pr.user;
          const sha = pr.head.sha;
          if (author.type === 'Bot') {{
            return setStatus(sha, 'success', 'bot account — CLA not required');
          }}
          // The probe throws on rate limits and unexpected responses. Publish
          // the infra error rather than letting it escape: an uncaught throw
          // fails the step without ever creating the status, which reads as a
          // permanently pending check instead of a diagnosable failure.
          let isMember;
          try {{
            isMember = await isOrgMember(author.login);
          }} catch (err) {{
            core.warning(`CLA org membership probe failed: ${{err.message}}`);
            return setStatus(sha, 'failure',
              'CLA infrastructure error — comment "/macro-cla check" to retry');
          }}
          if (isMember) {{
            return setStatus(sha, 'success', 'macro-inc member — covered by CIIA');
          }}
          let result;
          try {{
            const res = await fetch(`${{WORKER_ORIGIN}}/cla/check?github_id=${{author.id}}`, {{
              headers: {{ authorization: `Bearer ${{process.env.CLA_CHECK_API_KEY}}` }},
            }});
            if (!res.ok) throw new Error(`worker returned ${{res.status}}`);
            result = await res.json();
          }} catch (err) {{
            // Fail closed, but say why: this is an infra failure, not "unsigned".
            core.warning(`CLA worker check failed: ${{err.message}}`);
            return setStatus(sha, 'failure',
              'CLA infrastructure error — comment "/macro-cla check" to retry');
          }}
          if (result.signed) {{
            return setStatus(sha, 'success', `CLA ${{result.version}} signed`);
          }}
          return setStatus(sha, 'failure',
            `CLA not signed — see CONTRIBUTING.md, sign at ${{SIGN_URL}}`);
        }}

        if (context.eventName === 'pull_request_target') {{
          await runCheck(context.payload.pull_request);
        }} else {{
          const command = (context.payload.comment.body ?? '').split('\n')[0].trim();
          const prNumber = context.issue.number;
          if (command === '/macro-cla') {{
            // Invitation is a maintainer-only communication act; it does not
            // touch check state (the check is already red for an unsigned
            // author). Arbitrary users must not be able to make the bot ping
            // PR authors, so non-members just get a thumbs-down.
            if (await isOrgMember(context.payload.comment.user.login)) {{
              const {{ data: pr }} = await github.rest.pulls.get({{ owner, repo, pull_number: prNumber }});
              await github.rest.issues.createComment({{
                owner, repo, issue_number: prNumber,
                body: [
                  `@${{pr.user.login}} — we'd like to merge this. Before we can, we need you to sign the`,
                  'Macro CLA (one time, covers all future contributions):',
                  `**${{SIGN_URL}}**`,
                  'Once signed, comment `/macro-cla check` here and the CLA check will go green.',
                ].join('\n'),
              }});
            }} else {{
              await github.rest.reactions.createForIssueComment({{
                owner, repo, comment_id: context.payload.comment.id, content: '-1',
              }});
            }}
          }} else if (command === '/macro-cla check') {{
            const {{ data: pr }} = await github.rest.pulls.get({{ owner, repo, pull_number: prNumber }});
            await runCheck(pr);
          }} else {{
            // Addressed to the bot but not a command we know (a typo like
            // "/macro-cla verify", or prose that happens to open with the
            // mention). React so the author learns it was seen and ignored
            // rather than silently dropped. Distinct from the '-1' above,
            // which means "recognized, but you may not run it".
            await github.rest.reactions.createForIssueComment({{
              owner, repo, comment_id: context.payload.comment.id, content: 'confused',
            }});
          }}
        }}
    "#}
}
