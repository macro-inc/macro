import './homepage-closing-content.css';

/** Quotes reproduced from the original solid-site homepage. */
export function HomepageTestimonials() {
  return (
    <section
      class="homepage-testimonials workspace-demo"
      aria-label="What people say about Macro"
    >
      <figure>
        <figcaption>
          <span>Alex Rampell</span>
          <span>General Partner, Andreessen Horowitz</span>
        </figcaption>
        <blockquote>
          “Macro is the biggest change to how companies work in years. By open
          sourcing and bringing everything into one workspace, agents and teams
          can move much faster.”
        </blockquote>
      </figure>
      <figure>
        <figcaption>
          <a
            href="https://x.com/ptaranat"
            target="_blank"
            rel="noopener noreferrer"
          >
            Panat Taranat
          </a>
          <span>@ptaranat</span>
        </figcaption>
        <blockquote cite="https://x.com/ptaranat">
          “Every startup should be using @macrodotcom man like for $40 you can
          get Notion, Slack, Linear, Zoom and the fastest UI i have ever seen
          for navigating Gmail like a StarCraft grandmaster”
        </blockquote>
      </figure>
    </section>
  );
}
