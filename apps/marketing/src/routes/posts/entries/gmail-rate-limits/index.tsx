import './GmailRateLimits.css';
import gmailBulkWarning from '../../../../assets/posts/gmail-rate-limits/gmail-bulk-warning.png';
import { Diagram, DiagramArrow, DiagramBox } from '../../PostDiagram';
import type { PostMeta } from '../../registry';

export const postMeta: PostMeta = {
  slug: 'gmail-rate-limits',
  title: 'Getting Rate Limited for Fun and Profit',
  seoTitle:
    'Getting Rate Limited for Fun and Profit — Working Within Gmail API Quotas',
  subtitle:
    'How we backfill an entire inbox as fast as Gmail will allow, without starving every other email operation in the product.',
  date: '2026-06-26',
  description:
    "How Macro works within Gmail's 6,000 quota-units-per-minute limit: a queue-driven backfill that retries on 429 via visibility timeouts, plus a Redis cost-based sliding window that reserves headroom for live inbox operations.",
  preview:
    'Backfilling an inbox at full speed is easy. Doing it while the user can still send, read, and archive email is the hard part.',
  tags: ['macro', 'engineering'],
  category: 'Engineering',
  // Cross-post from the building-in-public push; lives at /posts, not on the homepage.
  hideFromHome: true,
  coverBrand: 'gmail-quota',
  image: '/og/gmail-rate-limits.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Evan', role: 'Macro Engineering' },
  ctaButtonName: 'blog_gmail_rate_limits_cta',
};

export default function GmailRateLimitsPost() {
  return (
    <div class="grl-post">
      <article>
        <p class="grl-lede">
          When we set out to add a{' '}
          <a href="https://macro.com/email/">first-class email client</a> to
          Macro last year, we started with Gmail support.
        </p>
        <p>
          To make email a first-class entity in Macro — linked with docs and
          agents, in unified search, with native mentions and powerful filtering
          and sorting — we needed the user's email in our own database. Which
          means that on sign-up, we needed to backfill the user's inbox as
          quickly as possible.
        </p>

        <h2>Hitting the quota limit</h2>
        <p>
          Gmail's API has a robust usage limit system, as detailed in{' '}
          <a href="https://developers.google.com/workspace/gmail/api/reference/quota">
            their docs
          </a>
          , and when trying to pull down a user's inbox at light speed, we
          quickly ran into the 6,000 quota units per minute per user limit. As
          soon as you hit that limit, the API starts returning{' '}
          <code>429 Too Many Requests</code> until it resets.
        </p>
        <p>
          Our backfill process is a queue-driven bulk-sync job. Each{' '}
          <a href="https://github.com/macro-inc/macro/blob/892c851c70ce12c0110151e30e635aae5fe9c6b2/rust/cloud-storage/models_email/src/email/service/backfill.rs#L55">
            operation
          </a>{' '}
          in the backfill is represented by a single message on the queue, which
          makes the retry mechanism for usage limits pleasantly simple: when
          Gmail returns a 429, we just don't ack the message responsible for the
          call. The message is automatically retried after its 60-second
          visibility timeout, by which point Gmail's usage limit has reset and
          the data comes back successfully.
        </p>
        <p>
          Email backfill was the first thing I built in the backend, and it
          worked swimmingly. With this strategy, we were confident we were
          backfilling inboxes as fast as Gmail would let us.
        </p>

        <h2>No headroom left for anything else</h2>
        <p>
          You may have already guessed the problem we ran into as soon as we
          started implementing other Gmail functionality: there were no quota
          units left for anything else during a backfill. Want to send an email?
          429. Want to mark a thread as read? 429. We could read emails as they
          were backfilled, and that was about the extent of it.
        </p>
        <p>
          It became clear we would have to preserve some headroom before the
          usage limiter kicked in. And how do you do that? By building your own
          usage limiter, of course.
        </p>

        <h2>Building our own usage limiter</h2>
        <p>
          As seen in{' '}
          <a href="https://github.com/macro-inc/macro/blob/main/rust/cloud-storage/email_service/src/util/redis/rate_limit.rs">
            <code>rate_limit.rs</code>
          </a>
          , the email backfill job uses a cost-based sliding window. Redis was
          the perfect fit, because it lets the entire usage limit check —
          expiring old entries, summing current usage, evaluating it, and
          storing the result — happen as a single atomic operation. Any number
          of pub/sub workers can run checks concurrently without racing past the
          limit.
        </p>
        <Diagram
          title="Reserving headroom inside one user's quota"
          alt="Backfill queue messages pass through a Redis cost-based sliding window that is configured to consume only part of the per-user quota, leaving the remainder for live inbox operations from the Macro UI."
          caption="The split is configurable: backfill gets a percentage of the per-minute quota, live operations keep the rest."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Backfill queue"
              items={['One op per message', 'Worker pool', 'No ack on 429']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Redis sliding window"
              items={['Cost-based', 'One atomic check', 'Configurable share']}
            />
            <DiagramArrow />
            <div class="pdg-stack">
              <DiagramBox
                title="Gmail API"
                items={['6,000 units', 'per minute', 'per user']}
              />
              <DiagramBox
                dashed
                title="Reserved"
                note="Sends, reads, and archives from the Macro UI still go through"
              />
            </div>
          </div>
        </Diagram>
        <p>
          The usage limiter is fully configurable, so we can dynamically set the
          percentage of available quota units that backfill is allowed to spend,
          leaving the rest for normal inbox operations in the Macro UI. Problem
          solved.
        </p>

        <h2>Round two: bulk operations</h2>
        <p>
          That is, until we added bulk email operations to Macro. Up until this
          point, every operation acted on a single email message at a time. Once
          we added the ability to act on many emails at once, we ran into the
          dreaded 429s all over again.
        </p>
        <p>
          Note that this isn't a third-party-only problem. Gmail's own UI
          acknowledges the usage limit when you try to archive or mark a large
          number of emails at once:
        </p>
        <figure class="grl-shot">
          <div class="grl-shot-frame">
            <img
              src={gmailBulkWarning}
              alt="A Gmail banner reading: We marked some conversations as read. We'll do the same for any remaining conversations in a few minutes. This might take longer, depending on how many conversations are selected."
              loading="lazy"
              width={1284}
              height={222}
              style={{
                width: '100%',
                height: 'auto',
                'aspect-ratio': '1284 / 222',
              }}
            />
          </div>
          <figcaption class="grl-figcaption">
            Even Gmail tells you it will get to the rest of your conversations
            in a few minutes.
          </figcaption>
        </figure>
        <p>
          The only way to confidently process large numbers of operations that
          are guaranteed to hit the usage limit is either to bottleneck requests
          or to have a solid retry mechanism in place. We already had the latter
          from the backfill job, so we took a page out of that book: all Gmail
          inbox operations are now done asynchronously. After updating our
          database, we send a message to a queue for the Gmail operations worker
          pool, which makes the request to the Gmail API. If that request is
          usage-limited, the message is auto-retried after the 60-second
          visibility timeout, exactly like a backfill message.
        </p>

        <h2>In summary</h2>
        <p>
          After some trial and error, the best strategy for working around
          Gmail's usage limit — for both backfilling and everyday inbox
          management — turned out to be queue-based systems with auto-retry
          through visibility timeouts, sitting behind a limiter that reserves
          headroom for the things a user is actually doing right now.
        </p>
        <p class="grl-hl">Now to do it all again with Outlook.</p>
      </article>
    </div>
  );
}
