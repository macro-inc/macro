import './MfsSharing.css';
import forgotToShare from '../../../../assets/posts/mfs-sharing/forgot-to-share.png';
import { Diagram, DiagramArrow, DiagramBox } from '../../PostDiagram';
import type { PostMeta } from '../../registry';

const ARTICLE_PARAGRAPHS = [
  "Access management is one of the hardest systems we've built at Macro, and the one we've rewritten the most. The design we finally landed on does the most work under the hood and is the easiest for users to understand.",
  'This is one part of a multi-part piece on how we design the Macro filesystem (MFS). Our focus in this article is the access management (permissions and sharing) system.',
] as const;
const ARTICLE_PREVIEW = ARTICLE_PARAGRAPHS.join(' ');

export const postMeta: PostMeta = {
  slug: 'mfs-sharing',
  title: 'The Macro Filesystem',
  seoTitle: 'The Macro Filesystem',
  subtitle:
    'How channel-based sharing made access management in Macro fast, simple, and free of side effects.',
  date: '2026-07-07',
  description:
    'How Macro rebuilt MFS permissions around channel-based sharing: a single flat entity_access table that took worst-case reads from over 10 seconds to about 600ms and removed membership side effects.',
  preview: ARTICLE_PREVIEW,
  tags: ['macro', 'engineering'],
  category: 'Engineering',
  coverBrand: 'mfs',
  image: '/og/mfs-sharing.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Will Hutchinson', role: 'Macro Engineering' },
  ctaButtonName: 'blog_mfs_sharing_cta',
};

const ACCESS_QUERY = `DELETE FROM entity_access
WHERE entity_id = ANY([document_a, document_b, project_c])
  AND granted_from_project_id = ANY([project_a, project_b]);`;

const ENTITY_ACCESS_SQL = `CREATE TABLE entity_access
(
  entity_id UUID NOT NULL,        -- document_id, project_id, chat_id, email_thread_id
  entity_type EntityType NOT NULL, -- document, project, chat, email
  source_id TEXT NOT NULL,         -- channel_id, team_id or macro_user_id if creator
  source_type TEXT NOT NULL,       -- channel, team, user if creator
  access_level AccessLevel NOT NULL, -- the access level granted to the source
  granted_from_project_id UUID     -- set when access came from a shared project
);`;

export default function MfsSharingPost() {
  return (
    <div class="mfs-post">
      <article>
        <p class="mfs-lede">{ARTICLE_PARAGRAPHS[0]}</p>
        <p class="mfs-note">
          <em>{ARTICLE_PARAGRAPHS[1]}</em>
        </p>

        <h2>Some background on the Macro Filesystem</h2>
        <p>
          The Macro Filesystem ("MFS") is a unique problem because, unlike
          single-purpose software (Linear for tasks, Slack for chat, Notion for
          notes), Macro needs a flexible schema that works across all of these
          content types. Every entity in Macro, whether it's a document, a
          project, a chat, or an email, lives in one workspace under one access
          model.
        </p>
        <p>
          MFS is also different from, and more complex than, a POSIX filesystem
          that just needs to store files on one machine:
        </p>
        <ul class="mfs-list">
          <li>
            MFS is real-time collaborative for certain entity types, like
            markdown docs, and version-controlled. It needs to support different
            types of collaboration for different entity types. A POSIX
            filesystem can assume a single machine, one owner editing a file at
            a time, and read/write/execute permissions.
          </li>
          <li>
            MFS needs to be globally available in under 100ms for every user, no
            matter where they are.
          </li>
          <li>
            MFS is multi-modal, not just files: channels, video calls, emails,
            and more over time.
          </li>
        </ul>
        <p>
          Beyond these requirements, MFS should be simple for users and
          developers to use. That is our design goal with Macro generally: it is
          why the app is built in Rust and SolidJS, and why we put so much
          effort into product design.
        </p>

        <h2>Designing permissions and sharing for MFS</h2>
        <p>
          When we talk about permissions, we mean which users and agents should
          have access to an entity. Sharing is closely related: it is the act of
          granting permissions and notifying users or agents of the grant via
          email, push notification, or Macro message.
        </p>
        <p>
          In designing sharing and permissions for MFS, we had the following
          goals:
        </p>
        <ol class="mfs-list">
          <li>
            MFS's sharing model should extend nicely to agents, not just humans.
          </li>
          <li>
            For humans, sharing should work the same way for every entity type
            as much as possible. Sharing a transcript of a call should not work
            differently than sharing a document.
          </li>
          <li>
            Sharing should be simple. We are not concerned with obtuse
            enterprise use cases, at least not yet. We are concerned with
            avoiding gotchas, protecting privacy, and making it very easy to
            use.
          </li>
          <li>
            Bad abstractions that create headaches for each block team (for
            example, the email team or the docs team) should be discarded. Where
            flexibility is needed, it should be allowed.
          </li>
        </ol>

        <h2>The first sharing system</h2>
        <p>
          MFS has had two main share models. The initial model was fairly
          standard and mirrored how Google Drive and other cloud drives let you
          share items.
        </p>
        <ul class="mfs-list">
          <li>Items can be made publicly accessible.</li>
          <li>
            Items can be shared with individual users or your entire
            organization.
          </li>
          <li>
            If a project (folder) is shared with you, then all items within that
            project are also shared with you.
          </li>
        </ul>
        <p>
          To support simple sharing we set up a <code>UserItemAccess</code>{' '}
          table that recorded every shared entity and who it was shared with. We
          made it purely user based: one row per user per item they could reach.
          Sharing a project with your organization meant writing a row for every
          member, so adding or removing someone from the org meant fanning that
          change out across every shared item. That was not ideal, but shared
          item counts were small and membership rarely changed, so it held up
          fine early on. (We have since dropped organizations entirely in favor
          of a new team system.)
        </p>
        <p>
          Finding all the items a user could access meant looking up your user
          id in <code>UserItemAccess</code> and, for every project, recursively
          drilling down into it to grab all sub-items. By all accounts this
          seemed fine at first and gave us everything we needed.
        </p>

        <Diagram
          title="The first sharing system"
          alt="Diagram of the first sharing system, where sharing a project writes one UserItemAccess row per user per item, so membership changes fan out across every shared item."
          caption="The first model mirrored cloud drives: per-user rows for every reachable item, with fan-out on every membership change."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Share"
              items={['Project A/ → organization', 'A/ contains 3 documents']}
            />
            <DiagramArrow />
            <DiagramBox
              title="UserItemAccess"
              items={[
                '1 row per user per item',
                '12 members × 4 items',
                '= 48 rows',
              ]}
            />
            <DiagramArrow />
            <DiagramBox
              dashed
              title="Problem"
              note="Adding or removing a member means rewriting rows across every shared item"
            />
          </div>
        </Diagram>

        <h2>The eureka moment</h2>
        <p>
          As time went on and channels (group messaging) were released, we
          frequently found ourselves sending docs to one another through a
          channel only to be hit with "I don't have access to this".
        </p>
        <figure class="mfs-shot">
          <div class="mfs-shot-frame">
            <img
              src={forgotToShare}
              alt="A Macro chat where Jacob shares a doc called Email Roadmap and Hutch replies: I think you forgot to share it with me"
              loading="lazy"
              width={928}
              height={402}
              style={{
                width: '100%',
                height: 'auto',
                'aspect-ratio': '928 / 402',
              }}
            />
          </div>
          <figcaption class="mfs-figcaption">
            The moment that started it: a doc sent in chat that the recipient
            could not open.
          </figcaption>
        </figure>
        <p>
          This is nothing unique to Macro. It happens half the time someone
          pastes a Google Docs link in Slack, or a Figma in a Notion. So we
          didn't initially recognize this was a problem we could solve.
        </p>
        <p>One day, though, we were sitting in the office and thought...</p>
        <p class="mfs-hl">
          <strong>"WAIT, we can fix this sharing foot-gun problem!"</strong>
        </p>

        <h2>Introducing: channel-based sharing</h2>
        <p>
          Because Macro has everything in one system, we thought: why not just
          "cascade" the permissions from the channel to the document? (Cascade
          was the first word we used to describe it.)
        </p>
        <p>
          Everybody in the channel should obviously have access to the document,
          whether it's a DM to Teo or a doc dropped into #engineers. You would
          never send something to someone and not want them to be able to open
          it.
        </p>
        <p>
          At first the idea was a webhook that would auto-share things with the
          members of a channel using the share system we already had. Sharing an
          item in a channel would grab every user in that channel and insert{' '}
          <code>UserItemAccess</code> rows for them. That bought us the behavior
          we wanted, but it piled onto the same problem as before: now channel
          membership changes also had to fan out across items.
        </p>
        <p>This all worked okay... but...</p>

        <h2>The problem: it was slow</h2>
        <p>
          Copying Google Drive seemed fine. The webhook idea seemed fine. But it
          was slow.
        </p>
        <p>
          As the number of items a user had grew with each new entity type, the
          recursive read query got slow, especially on a cache miss. For some
          power users it could take over 10 seconds to grab their accessible
          items, depending on database load and other factors. The cause was the
          shape of their data: large nested projects alongside many root-level
          items, which the query planner couldn't walk efficiently.
        </p>
        <p>
          On top of the read cost, the write side was a liability of its own.
          Every channel or org membership change meant remembering to grant or
          revoke the right items, which was easy to get wrong. This was
          unacceptable to us, and I began designing a new system to fix both
          halves.
        </p>
        <p>Why not rework the whole sharing system around channels?</p>
        <p class="mfs-hl">
          Instead of a webhook side effect, what if the sharing system itself
          was channel-based, instead of working like Google Drive?
        </p>
        <p>
          We explored the edge cases, found nothing fatal, and decided to
          rebuild sharing around channels.
        </p>

        <h2>Making channel-based sharing fast</h2>
        <p>
          The new design flattens everything into a single table and requires no
          recursion at read time, at the cost of becoming more write heavy. The
          recursion doesn't disappear; it moves to write time, which happens far
          less often and tolerates latency much better. That trade works for us
          because the vast majority of items aren't deeply nested, and it leaves
          the door open to push writes onto an event-based pipeline later
          without touching the read path.
        </p>
        <pre class="mfs-code" aria-label="entity_access table definition">
          {ENTITY_ACCESS_SQL}
        </pre>
        <p>
          Like the rest of Macro, the implementation is open source at{' '}
          <a
            href="https://github.com/macro-inc/macro"
            target="_blank"
            rel="noreferrer"
          >
            github.com/macro-inc/macro
          </a>
          .
        </p>
        <p>
          How does the <code>entity_access</code> system fix the previous
          iterations' shortcomings?
        </p>
        <p>
          Instead of creating records per user, we create them per source for
          channels and teams. Removing a user from a channel or a team is as
          simple as deleting them as a member of that channel or team.{' '}
          <span class="mfs-hl">No more side effects.</span>
        </p>
        <p>
          The source of an <code>entity_access</code> row can be a channel, a
          team, or a user (for item creators).
        </p>
        <p>
          <code>granted_from_project_id</code> tells us which shared project
          produced the row. If that project is later deleted or moved, it
          becomes much easier to update all the affected records.
        </p>

        <Diagram
          title="Channel-based sharing"
          alt="Diagram of the entity_access model: channels, teams, and creators are sources; each grant is one row per source per entity; members resolve through their channels and teams at read time."
          caption="One flat table: grants live per source, not per user, and members resolve through their channels and teams at read time."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Sources"
              items={['channel_1', 'team_1', 'user (creator)']}
            />
            <DiagramArrow />
            <DiagramBox
              title="entity_access"
              items={[
                '1 row per source per entity',
                'access_level',
                'granted_from_project_id',
              ]}
            />
            <DiagramArrow />
            <DiagramBox
              title="Entities"
              items={['documents', 'projects', 'chats', 'emails']}
            />
          </div>
          <div class="pdg-footnote">
            <DiagramBox
              dashed
              title="Membership"
              note="Who is in a channel or team is resolved at read time, so membership changes touch nothing else"
            />
          </div>
        </Diagram>

        <h3>Adding an item to a project</h3>
        <p>In this example we have the following project structure:</p>
        <pre class="mfs-code" aria-label="Project tree">{`A/ -- owner 1
-- B/ -- owner 2
---- C/
------ add item here`}</pre>
        <p>
          Say we are adding an item to project C. Programmatically, we need to
          walk up the tree to get all parent project ids, including{' '}
          <code>project_c</code> itself. That gives us{' '}
          <code>[project_a, project_b, project_c]</code>. Next, we get all
          channel and team source entries and access levels for those projects.
        </p>
        <div class="mfs-table-wrap">
          <table class="mfs-table">
            <thead>
              <tr>
                <th>source_id</th>
                <th>source_type</th>
                <th>access_level</th>
                <th>granted_from_project_id</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>channel_1</code>
                </td>
                <td>channel</td>
                <td>view</td>
                <td>
                  <code>project_a</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>team_1</code>
                </td>
                <td>team</td>
                <td>comment</td>
                <td>
                  <code>project_b</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>team_2</code>
                </td>
                <td>team</td>
                <td>edit</td>
                <td>
                  <code>project_c</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>In this example:</p>
        <ul class="mfs-list">
          <li>
            <code>project_a</code> was shared with <code>channel_1</code>, so{' '}
            <code>channel_1</code> should have view access
          </li>
          <li>
            <code>project_b</code> was shared with <code>team_1</code>, so it
            should get comment access
          </li>
          <li>
            <code>project_c</code> was shared with <code>team_2</code> with edit
            access
          </li>
        </ul>
        <p>With that information we insert the following records:</p>
        <div class="mfs-table-wrap">
          <table class="mfs-table">
            <thead>
              <tr>
                <th>entity_id</th>
                <th>entity_type</th>
                <th>source_id</th>
                <th>source_type</th>
                <th>access_level</th>
                <th>granted_from_project_id</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>channel_1</code>
                </td>
                <td>channel</td>
                <td>view</td>
                <td>
                  <code>project_a</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>team_1</code>
                </td>
                <td>team</td>
                <td>comment</td>
                <td>
                  <code>project_b</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>team_2</code>
                </td>
                <td>team</td>
                <td>edit</td>
                <td>
                  <code>project_c</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>&lt;user_id&gt;</code>
                </td>
                <td>user</td>
                <td>owner</td>
                <td></td>
              </tr>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>owner1</code>
                </td>
                <td>user</td>
                <td>owner</td>
                <td>
                  <code>project_a</code>
                </td>
              </tr>
              <tr>
                <td>
                  <code>&lt;entity_id&gt;</code>
                </td>
                <td>
                  <code>&lt;entity_type&gt;</code>
                </td>
                <td>
                  <code>owner2</code>
                </td>
                <td>user</td>
                <td>owner</td>
                <td>
                  <code>project_b</code>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Alongside the channel and team sources, we also fetch each parent
          project's owner (<code>owner1</code>, <code>owner2</code>) and insert
          an owner row for them, so they keep access to items added anywhere
          beneath their projects. The <code>&lt;user_id&gt;</code> row with no{' '}
          <code>granted_from_project_id</code> is the creator of the new item
          itself.
        </p>
        <p>
          Granted, there is more work upfront to insert correct access for a new
          item in a project. But our workload is very read heavy, and we should
          prioritize reads over insertion speed.
        </p>

        <h3>Moving a sub-project</h3>
        <p>In this example we have the following projects:</p>
        <pre class="mfs-code" aria-label="Project trees">{`A/
-- B/
---- C/
------ document_a
------ document_b

X/
-- Y/
---- Z/`}</pre>
        <p>We are going to move project C from project B into project Z.</p>
        <p>
          We walk up the project tree to get all parent project ids (
          <code>project_a</code>, <code>project_b</code>). Notably this excludes{' '}
          <code>project_c</code>, since none of its own permissions change.{' '}
          <code>project_c</code> can still be shared with the same teams and
          channels it was before, with no changes required.
        </p>
        <p>
          Next we get all items in <code>project_c</code> (
          <code>document_a</code>, <code>document_b</code>), and then:
        </p>
        <pre class="mfs-code" aria-label="Delete query for the move">
          {ACCESS_QUERY}
        </pre>
        <p>
          This removes the implicit permissions that parent projects granted
          while <code>project_c</code> lived inside them. Finally, we run the
          same steps as adding an item to a project for everything in project C,
          including project C itself, under its new parents.
        </p>

        <h3>Deleting a project</h3>
        <p>
          When a project is deleted, all of its items are deleted as well. The
          process is the same as it was with <code>UserItemAccess</code>, with a
          slightly different query: delete from <code>entity_access</code> where{' '}
          <code>granted_from_project_id = x OR entity_id = x</code>.
        </p>

        <h3>How we access items</h3>
        <p>
          Now, instead of the recursive tree walk over projects to find
          accessible items, we simply get the user's channels and teams (easily
          cacheable queries) and then run one query on{' '}
          <code>entity_access</code> with{' '}
          <code>source_id = ANY([channels, teams, user_id])</code>.
        </p>
        <p>
          Because a user can reach the same entity through multiple sources (for
          example, a channel that grants view and a team that grants edit), this
          query can return more than one row for a single entity. When that
          happens, the highest access level wins, so in that example the user
          ends up with edit.
        </p>

        <Diagram
          title="The read path, before and after"
          alt="Diagram comparing the read path before and after: before, a recursive project walk over UserItemAccess took over 10 seconds worst case; after, one indexed entity_access lookup by the user's channels and teams takes about 600 milliseconds."
          caption="The read path collapses to one indexed lookup; the tree walk only happens on writes."
        >
          <div class="pdg-duo">
            <div class="pdg-group">
              <div class="pdg-group-title">Before</div>
              <div class="pdg-chain">
                <span class="pdg-pill">User</span>
                <DiagramArrow />
                <span class="pdg-pill">UserItemAccess</span>
                <DiagramArrow />
                <span class="pdg-pill">Recursive project walk</span>
              </div>
              <p class="pdg-group-note">
                Over 10 seconds worst case on a cache miss
              </p>
            </div>
            <div class="pdg-group">
              <div class="pdg-group-title">After</div>
              <div class="pdg-chain">
                <span class="pdg-pill">User</span>
                <DiagramArrow />
                <span class="pdg-pill">Channels + teams</span>
                <DiagramArrow />
                <span class="pdg-pill">One entity_access lookup</span>
              </div>
              <p class="pdg-group-note">About 600ms for the same worst case</p>
            </div>
          </div>
          <div class="pdg-diagram-footer">
            Recursion moved from read time to write time
          </div>
        </Diagram>

        <h2>Conclusion</h2>
        <p>
          Sharing is now as easy as sending someone a message, and we can
          retrieve everything a user has access to quickly. Flattening entity
          access into a single table reshaped the system around the access
          pattern that actually mattered to us:
        </p>
        <ul class="mfs-list">
          <li>
            Reads got fast. The recursive tree walk became a single indexed
            lookup, taking our worst-case power user from over 10 seconds on a
            cache miss down to about 600ms.
          </li>
          <li>
            Membership changes lost their side effects. Grants are stored per
            source rather than per user, so adding or removing someone from a
            channel or team is just adding or removing a member.
          </li>
        </ul>
        <p>
          There are still downsides, of course. The recursion wasn't eliminated;
          it moved to write time, where granting access still has to walk the
          project tree. Our workload is overwhelmingly read heavy, which made
          that trade easy to stomach. And the nature of the writes lets us set
          up an event-based pipeline if we ever have enough volume to need to
          process them asynchronously.
        </p>
      </article>
    </div>
  );
}
