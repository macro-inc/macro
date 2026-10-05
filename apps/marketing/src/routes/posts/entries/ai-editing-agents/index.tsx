import './AiEditingAgents.css';
import aiPeerCursor from '../../../../assets/posts/ai-editing-agents/ai-peer-cursor.png';
import type { PostMeta } from '../../registry';

const ORIGINAL_URL = 'https://404wolf.com/posts/AgentsAttackTheDocument/';

export const postMeta: PostMeta = {
  slug: 'ai-editing-agents',
  title: 'Agents Attacking Documents with CRDTs',
  seoTitle:
    'Agents Attacking Documents with CRDTs — How Macro Does AI Document Editing',
  subtitle:
    'A team of small agents writes code against a thin library to surgically edit the document tree, streaming their changes in as human-looking CRDT peers.',
  date: '2026-07-09',
  description:
    'How Macro built live collaborative AI document editing: an XML lens over the editor tree, a supervisor dispatching cheap writer agents, and an animation layer that streams their edits in as CRDT peers.',
  preview:
    'Swapping whole Markdown blocks was too coarse and LLMs are terrible at JSON patches. So we gave a team of small agents a thin library and let them edit the tree directly.',
  tags: ['macro', 'engineering'],
  category: 'Engineering',
  // Cross-post from the building-in-public push; lives at /posts, not on the homepage.
  hideFromHome: true,
  coverBrand: 'ai-editing',
  image: '/og/ai-editing-agents.png',
  author: { name: 'Wolf', role: 'Macro Engineering' },
  ctaButtonName: 'blog_ai_editing_agents_cta',
};

export default function AiEditingAgentsPost() {
  return (
    <div class="aie-post">
      <article>
        <p class="aie-lede">
          One of my first tasks at Macro: make it possible for AI to edit
          documents across the platform. Or, put less generously, create swarms
          of agents that come in and attack your documents with requested
          changes while you are mid-edit.
        </p>
        <figure class="aie-shot">
          <div class="aie-shot-frame">
            <img
              src={aiPeerCursor}
              alt="A Macro document titled Hello World Doc with the text 'hello world' being typed by a labelled cursor reading 'Wolf (AI)'"
              loading="lazy"
              width={709}
              height={284}
              style={{
                width: '100%',
                height: 'auto',
                'aspect-ratio': '709 / 284',
              }}
            />
          </div>
          <figcaption class="aie-figcaption">
            To the rest of the document, an agent is just another peer with a
            name and a cursor.
          </figcaption>
        </figure>
        <p>
          Macro documents are a tree, not flat Markdown, and they sync live
          between peers with{' '}
          <a href="https://en.wikipedia.org/wiki/Conflict-free_replicated_data_type">
            CRDTs
          </a>
          . Our first pass let an LLM swap whole top-level blocks with generated
          Markdown. It was far too coarse — it either rewrote much more than you
          asked for or missed the point entirely — so we un-shipped it.
        </p>
        <p>
          The second version hands agents an XML <em>lens</em> over the tree
          instead. A supervisor reasons about what needs to change and
          dispatches cheap, fast writer agents that emit tiny mutations against
          a thin library. Those operations get chopped into keystrokes and
          streamed to everyone on the document, so an edit arrives looking like
          a person typing rather than a block being replaced.
        </p>
        <p class="aie-crosslink">
          I wrote the whole thing up on my own site: the document views I tried
          and rejected, the edit library the writer agents code against, and a
          full trace of one "write hello world in my document" request.{' '}
          <a href={ORIGINAL_URL}>Read it on 404wolf.com →</a>
        </p>
        <p>
          Macro is open source, so you can also just read{' '}
          <a href="https://github.com/macro-inc/macro/tree/main/js/ai-editing-worker">
            the AI editing worker
          </a>
          .
        </p>
      </article>
    </div>
  );
}
