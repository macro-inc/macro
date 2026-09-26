import alexRampell from '../assets/alex-rampell.png';
import './homepage-closing-content.css';

/** Quote reproduced from the original solid-site homepage. */
export function HomepageTestimonials() {
  return (
    <section
      id="homepage-testimonial"
      class="homepage-testimonials workspace-demo"
      aria-label="What people say about Macro"
    >
      <figure>
        <blockquote>
          “Macro is the biggest change to how companies work in years. By open
          sourcing and bringing everything into one workspace, agents and teams
          can move much faster.”
        </blockquote>
        <figcaption>
          <img
            src={alexRampell}
            alt="Alex Rampell"
            width="64"
            height="64"
            loading="lazy"
            decoding="async"
          />
          <div class="homepage-testimonial-attribution">
            <span class="homepage-testimonial-name">Alex Rampell</span>
            <span>General Partner, Andreessen Horowitz</span>
          </div>
        </figcaption>
      </figure>
    </section>
  );
}
