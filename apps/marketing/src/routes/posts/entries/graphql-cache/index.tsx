import './GraphqlCache.css';
import { Diagram, DiagramArrow, DiagramBox } from '../../PostDiagram';
import type { PostMeta } from '../../registry';

export const postMeta: PostMeta = {
  slug: 'graphql-cache',
  title: 'Building a GraphQL Cache That Doesn’t Have to Fit in Memory',
  seoTitle: 'Building a GraphQL Cache That Doesn’t Have to Fit in Memory',
  subtitle:
    'How we designed a disk-backed, Rust-powered normalized cache for a workspace with documents, email, chat, tasks, CRM, notes, and files.',
  date: '2026-07-06',
  description:
    'How Macro built a disk-backed, Rust-powered normalized GraphQL cache with bounded memory, offline replay, and shared browser/desktop architecture.',
  tags: ['macro', 'engineering'],
  category: 'Engineering',
  // Was excluded from the homepage by slug in SectionHomeBlog; same behaviour,
  // expressed as post metadata now that other posts opt out the same way.
  hideFromHome: true,
  coverBrand: 'graphql',
  image: '/og/graphql-cache.png',
  showTOC: true,
  tocDepth: 2,
  author: { name: 'Sean', role: 'Macro Engineering' },
  ctaButtonName: 'blog_graphql_cache_cta',
};

export default function GraphqlCachePost() {
  return (
    <div class="gqc-post">
      <article>
        <p class="gqc-lede">
          GraphQL clients have a wonderful property: once you’ve fetched an
          object, every part of your application can reference the same copy.
        </p>
        <p>
          Instead of storing entire query responses, modern GraphQL clients use
          normalized caches. Each entity is stored exactly once, and queries
          become references into that graph.
        </p>
        <p>
          For most applications, this works extremely well. Until the cache gets
          big.
        </p>
        <p>
          Macro is a workspace for teams that brings documents, email, chat,
          tasks, CRM, notes, and files into one connected system. That means the
          application is not just rendering a few screens. It is constantly
          navigating a large object graph: documents connected to projects,
          messages connected to threads, tasks connected to people, properties
          connected to entities, and search surfaces connected to all of the
          above.
        </p>
        <p>
          As we migrated more of that data fetching from REST to GraphQL, we
          realized the cache itself was becoming infrastructure. A user can
          easily accumulate hundreds of thousands of objects over time:
          documents, email threads, messages, tasks, properties, comments, and
          relationships between them.
        </p>
        <p class="gqc-hl">
          Traditional GraphQL caches were not designed for that shape of data.
        </p>

        <h2>The problem with today’s GraphQL caches</h2>
        <p>
          Libraries like Graphcache, Apollo Cache, and Relay all store
          normalized entities in memory.
        </p>
        <p>
          Persistence usually works by serializing that in-memory cache into
          IndexedDB so it survives a page refresh. Unfortunately, persistence
          does not actually solve the memory problem.
        </p>
        <pre class="gqc-code" aria-label="Persistence lifecycle">
          {`Memory
  ↓
Serialize
  ↓
IndexedDB
  ↓
Reload
  ↓
Read everything back into memory`}
        </pre>
        <p>
          The cache survives a restart, but it still has to fit into browser
          memory. As datasets grow, so do memory usage, garbage collection
          pauses, startup time, and the amount of work required to hydrate the
          cache.
        </p>

        <Diagram
          title="Traditional GraphQL cache"
          alt="Diagram of a traditional GraphQL cache where network responses are normalized into an in-memory cache and persisted as JSON in IndexedDB, but still need to hydrate back into memory after restart."
          caption="Traditional persistence helps the cache survive reloads, but the full normalized graph still has to fit back into memory."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Network responses"
              items={['Queries', 'Entities', 'Relationships']}
            />
            <DiagramArrow />
            <DiagramBox
              title="In-memory normalized cache"
              items={['User:1', 'Doc:42', 'Thread:9', 'Task:7', '…']}
            />
            <DiagramArrow />
            <div class="pdg-stack">
              <DiagramBox
                title="Persistence"
                items={['JSON', 'IndexedDB', 'Hydrate on reload']}
              />
              <DiagramBox
                dashed
                title="Problem"
                note="Everything still needs to fit back into memory after restart"
              />
            </div>
          </div>
        </Diagram>

        <p>
          For applications with relatively small datasets, that is perfectly
          reasonable. For a workspace like Macro, where the cache may eventually
          contain hundreds of thousands of interconnected objects, it becomes a
          bottleneck.
        </p>

        <h2>Thinking of the cache as a database</h2>
        <p>
          The key insight was that a GraphQL cache does not actually need to
          behave like an in-memory JavaScript object. It can behave more like a
          database.
        </p>
        <p>
          Instead of keeping every entity resident in memory, we split the cache
          into two tiers.
        </p>
        <pre class="gqc-code" aria-label="Hot and cold tiers">
          {`Hot entities  → Memory
Cold entities → Persistent storage`}
        </pre>
        <p>
          The memory tier uses an LRU eviction policy. Recently accessed
          entities remain in memory. Older entities are serialized to disk. When
          they are needed again, they are transparently loaded back into memory.
        </p>
        <p class="gqc-hl">
          The important property is that memory usage stays bounded regardless
          of how much data exists overall.
        </p>

        <Diagram
          title="Paged cache"
          alt="Diagram of a paged cache with queries flowing into a normalized store split into a hot tier in bounded memory and a cold tier backed by postcard records on disk."
          caption="A paged normalized store keeps the active working set hot while preserving a much larger total cache on disk."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Queries"
              items={['Doc list', 'Inbox', 'Project view']}
            />
            <DiagramArrow />
            <div class="pdg-group">
              <div class="pdg-group-title">Normalized store</div>
              <div class="pdg-row pdg-row--inner">
                <DiagramBox
                  dashed
                  title="Hot tier"
                  items={['Recently used', 'Bounded memory', 'LRU']}
                />
                <DiagramArrow />
                <DiagramBox
                  dashed
                  title="Cold tier"
                  items={['Postcard records', 'Disk-backed', 'Load on demand']}
                />
              </div>
            </div>
            <DiagramArrow />
            <DiagramBox
              title="Result"
              items={[
                'Large total cache',
                'Small memory footprint',
                'Offline replay',
              ]}
            />
          </div>
        </Diagram>

        <p>Instead of this:</p>
        <pre class="gqc-code" aria-label="Traditional all-in-memory model">
          {`500,000 entities → JavaScript heap`}
        </pre>
        <p>We get this:</p>
        <pre class="gqc-code" aria-label="Paged cache model">
          {`500,000 entities total
 15,000 hot  → Memory
485,000 cold → Disk`}
        </pre>
        <p>
          The cache starts looking much more like virtual memory than a
          traditional frontend cache.
        </p>

        <h2>Why Rust?</h2>
        <p>
          The cache engine is written in Rust and compiled to WebAssembly. Rust
          gives us three advantages.
        </p>
        <h3>Deterministic memory management</h3>
        <p>
          The entire point of this architecture is explicit control over memory.
          Rust lets us reason precisely about when records are allocated,
          evicted, serialized, and dropped. That makes it much easier to build
          predictable eviction behavior than relying on JavaScript’s garbage
          collector.
        </p>
        <h3>Compact persistence</h3>
        <p>
          Instead of serializing cache records as JSON, we serialize them using
          Postcard, a compact binary format. Binary serialization reduces
          storage requirements, which matters when persisting very large
          normalized graphs.
        </p>
        <h3>Systems programming tools</h3>
        <p>
          Normalization, dependency tracking, serialization, persistence, and
          eviction are fundamentally systems problems. Rust is an excellent
          language for implementing storage engines.
        </p>

        <h2>Moving work to compile time</h2>
        <p>
          A normalized cache needs to understand the GraphQL schema. It has to
          answer questions like:
        </p>
        <ul class="gqc-list">
          <li>How is each entity identified?</li>
          <li>Which fields reference other entities?</li>
          <li>Which values should remain embedded?</li>
          <li>Which union members are possible?</li>
        </ul>
        <p>
          Most GraphQL caches compute this information while the application is
          running. Instead, we generate schema metadata during compilation and
          embed it directly into the cache engine.
        </p>

        <Diagram
          title="Compile-time schema awareness"
          alt="Diagram of compile-time schema awareness, showing schema types, interfaces, and unions passing through codegen into the cache engine so runtime does less introspection and repeated work."
          caption="When the schema is known ahead of time, normalization rules can be generated once instead of rediscovered at runtime."
        >
          <div class="pdg-row">
            <DiagramBox
              title="Schema"
              items={['Types', 'Interfaces', 'Unions']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Codegen"
              items={['Key config', 'Field metadata', 'Possible types']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Cache engine"
              items={['Normalize', 'Denormalize', 'Track dependencies']}
            />
            <DiagramArrow />
            <DiagramBox
              title="Runtime"
              items={[
                'Less introspection',
                'Less repeated work',
                'Smaller payload',
              ]}
            />
          </div>
          <div class="pdg-footnote">
            <DiagramBox
              dashed
              title="Why"
              note="Know the graph ahead of time. Push schema work out of runtime."
            />
          </div>
        </Diagram>

        <p>
          The runtime no longer needs to inspect the schema. It already knows
          how every entity should be normalized. Besides reducing runtime work,
          this also lets us ship less JavaScript.
        </p>

        <h2>One cache, multiple windows</h2>
        <p>
          The browser implementation runs inside a Shared Worker. Rather than
          every browser tab maintaining its own cache, every window communicates
          with the same cache engine.
        </p>

        <Diagram
          title="Browser + desktop architecture"
          alt="Diagram comparing browser and desktop cache architecture: browser uses app, shared worker, WASM cache, and IndexedDB; desktop uses app, native host, Rust cache, and SQLite."
          caption="The same core cache engine can run behind different hosts: WASM and IndexedDB in the browser, native Rust and SQLite on desktop."
        >
          <div class="pdg-duo">
            <div class="pdg-group">
              <div class="pdg-group-title">Browser</div>
              <div class="pdg-chain">
                <span class="pdg-pill">App</span>
                <DiagramArrow />
                <span class="pdg-pill">Shared Worker</span>
                <DiagramArrow />
                <span class="pdg-pill">WASM cache</span>
                <DiagramArrow />
                <span class="pdg-pill">IndexedDB</span>
              </div>
              <p class="pdg-group-note">
                Fallback: dedicated workers + BroadcastChannel
              </p>
            </div>
            <div class="pdg-group">
              <div class="pdg-group-title">Desktop</div>
              <div class="pdg-chain">
                <span class="pdg-pill">App</span>
                <DiagramArrow />
                <span class="pdg-pill">Native host</span>
                <DiagramArrow />
                <span class="pdg-pill">Rust cache</span>
                <DiagramArrow />
                <span class="pdg-pill">SQLite</span>
              </div>
            </div>
          </div>
          <div class="pdg-diagram-footer">Same core engine, different host</div>
        </Diagram>

        <p>
          That gives us a single source of truth while keeping normalization
          work off the main thread. Browsers without Shared Worker support fall
          back to dedicated workers synchronized through BroadcastChannel.
        </p>
        <p>
          On desktop, we take this one step further. Instead of running inside
          WebAssembly, the same Rust cache engine runs natively inside the
          application and persists to SQLite. The browser and desktop versions
          share the same core implementation while using storage that is
          appropriate for each platform.
        </p>

        <h2>A local object store</h2>
        <p>
          The interesting part of this project is not that it is written in
          Rust. It is that we are starting to think about the client-side
          GraphQL cache as a storage engine.
        </p>
        <p>
          Instead of an in-memory object graph, it becomes a local object store
          with:
        </p>
        <ul class="gqc-list">
          <li>normalized records</li>
          <li>bounded memory</li>
          <li>persistent storage</li>
          <li>offline support</li>
          <li>compile-time schema metadata</li>
          <li>cross-window synchronization</li>
        </ul>
        <div class="gqc-callout">
          <p>
            GraphQL caches have traditionally optimized for correctness and
            developer experience. We are optimizing for something slightly
            different: making the cache capable of holding an entire workspace
            without requiring the entire workspace to live in memory.
          </p>
        </div>
        <p>
          As applications continue moving toward local-first architectures, this
          becomes an increasingly useful abstraction. The cache is not just
          somewhere to keep yesterday’s network responses.
        </p>
        <p class="gqc-hl">
          It is becoming the local database your application runs on.
        </p>
      </article>
    </div>
  );
}
