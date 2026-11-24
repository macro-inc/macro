import avatarJacob from '../../../assets/people/jacob.webp';
import './homepage/homepage-founder-letter.css';

export function HomepageFounderLetter() {
  return (
    <section
      class="homepage-founder-letter"
      aria-label="A note from our founder"
    >
      <div class="homepage-founder-letter-body">
        <p>
          At our last startup things started breaking right around twenty
          people. Engineering, sales, and marketing each picked their own tools,
          so our context ended up scattered across Slack, email, docs, meetings,
          and a dozen SaaS apps held together with glue. We were paying for all
          of them separately and nothing worked as one system.
        </p>
        <p>
          We built Macro to be one open source system for the whole company.
          Email, chat, docs, tasks, calendar, calls, and CRM live together in
          one workspace so your software bill drops, your data stays yours, and
          your team and agents can actually work off the same shared memory.
        </p>
      </div>
      <footer class="homepage-founder-letter-signature">
        <img
          src={avatarJacob}
          alt="Jacob Beckerman"
          width="34"
          height="34"
          loading="lazy"
          decoding="async"
        />
        <div class="homepage-founder-letter-author">
          <span class="homepage-founder-letter-name">Jacob Beckerman</span>
          <span>Co-Founder &amp; CEO, Macro</span>
        </div>
      </footer>
    </section>
  );
}
