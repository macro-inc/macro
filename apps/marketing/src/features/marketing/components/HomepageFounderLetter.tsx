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
          Most companies run on twenty separate SaaS tools that were never meant
          to work together. You pay per seat in every app while context stays
          scattered, and AI agents only see a tiny slice of the business.
        </p>
        <p>
          We built Macro to be one open source system for your whole company.
          Bringing email, chat, docs, tasks, calendar, calls and CRM into one
          workspace cuts your software bill, keeps your data yours, and gives
          your team and agents the same shared memory from day one.
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
