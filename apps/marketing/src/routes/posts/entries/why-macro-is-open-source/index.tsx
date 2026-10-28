import './WhyOpenSource.css';
import avatarJacob from '../../../../assets/people/jacob.webp';
import type { PostMeta } from '../../registry';

const ARTICLE_PREVIEW =
  'Macro is not open source because I like Richard Stallman. I don’t personally use Linux. I have an iPhone and I prefer when people text me with blue bubbles, though of course I think this is a bit of an anti-competitive practice. My point is I am not an open source maximalist. Nor am I a free software evangelist.';

export const postMeta: PostMeta = {
  slug: 'why-macro-is-open-source',
  title: 'Why Macro Is Open Source',
  seoTitle: 'Why Macro Is Open Source',
  subtitle:
    'These are all the reasons I can think of that I considered (at length! many sleepless nights!) before making Macro open source.',
  date: '2026-08-07',
  description:
    'Why Macro is fully open source under AGPLv3 rather than open core or source available: trust, extensibility, hiring, positioning, and what we decided about self-hosting.',
  preview: ARTICLE_PREVIEW,
  tags: ['macro', 'open source'],
  category: 'Company',
  coverBrand: 'open-source',
  image: '/og/why-macro-is-open-source.png',
  author: { name: 'Jacob Beckerman', role: 'Macro', avatar: avatarJacob },
  ctaButtonName: 'blog_why_macro_is_open_source_cta',
};

export default function WhyMacroIsOpenSourcePost() {
  return (
    <div class="wos-post">
      <article>
        <p>{ARTICLE_PREVIEW}</p>

        <p>
          <strong class="wos-highlight">
            Macro is open source because if I was not the founder of Macro, but
            rather an arms-length user of Macro, I would want it to be open
            source.
          </strong>{' '}
          I apply this logic to not only the license but all features; and I
          consider the license to be an important feature of the product.
        </p>

        <p>
          Macro is open source because we need people to trust us. Open source
          is a boon for general trust because (i) you can self-host, which we
          don’t really recommend except for certain military and healthcare use
          cases (ii) if you choose not to self-host you at least know you can
          move your data at any point in time to a self-hosted version (iii) you
          can have more trust your data is secure and (iv) you know that the
          operation of your workspace is not contingent on our continued
          solvency — in a prior business when I was making closed source
          software one thing that enterprise buyers asked for was a “source
          code” provision that we give them our code in case of insolvency. In
          our current business we never need to make that specific promise
          because it is true by default.
        </p>

        <p>
          Macro is not open source because we want people to self-host. We are
          okay with companies self-hosting, and this is built into our
          commercial model. Companies do not need to pay us if they self-host,
          but since many large enterprises have qualms with running AGPL
          software, we expect many will want a commercial + support license from
          us. But we don’t really want this. It’s more support work and it
          fragments the ecosystem (e.g. the ability to collaborate across
          companies).
        </p>

        <p>
          Macro is not open source because we expect contributions outside the
          core team. We welcome external contributions but thus far they’ve been
          mediocre and somewhat of a distraction (though of course, we are very
          thankful for contributor’s time and/or inference spend).
        </p>

        <p>
          Macro is open source despite most open source projects having poor
          design. Product design is central to Macro. In my opinion, Apple
          (circa 2010s, at least) is the pinnacle of product design. And Apple
          is very closed source. One of the main pushbacks against going open
          source I got from our team was that open source application software
          (e.g. LibreOffice) is generally not well-designed. Why? I think this
          is due to (i) the characteristics of the people that build open
          source, i.e. engineers not designers, and (ii) the decentralized
          nature of open source projects makes it hard to do good design. (Good
          design requires consistency and taste and quality control, all of
          which require centralization and power vested in a small number of
          individuals to hold a high bar.)
        </p>

        <p>
          Macro is open source despite limited early support from our team. When
          I tell people Macro is open source they are surprised to learn this
          was because I pushed for this strongly, against the advice of some of
          our engineers, and without the resounding support of our company.
        </p>

        <p>
          It was my strongly held conviction for a while before actually pulling
          the trigger that we should be open source. I am happy about it, but it
          is also an inevitability. Open source business software makes too much
          sense. This is the way the world will work whether we do it or not. So
          we ought to do it, and lead, or someone else will.
        </p>

        <p>
          Macro is open source because we want it to be as extensible and
          modular as possible. It’s possible to have a great plugin system
          without being open source, like Figma or Minecraft. But it’s easier to
          build on top of something that’s fully open.
        </p>

        <p>
          We’re not sure exactly what’s going to be built on top of Macro, but
          we’re confident “the operating system for your company,” which Macro
          promises to be, needs to be as customizable as possible. And not just
          in the way things like Slack or Notion are customizable; much more
          than that. The workspace itself should be programmable.
        </p>

        <p>
          Macro is open source for the aura, vibes, and moral high ground.
          Everybody loves open source software. People who don’t understand
          software can be quickly educated and become supportive of open source.
          But the main reason is to appeal to techies — engineers and
          executives/founders who might be trained in technical fields — who are
          excited about an open source system they can build on top of. The
          second order effects of this point probably go underweighted, even
          when taking into account that they are underweighted. It really is
          perception-shifting to be open source.
        </p>

        <p>
          Macro is open source because the best people want to work on open
          source. That’s not to say the best people don’t mostly work on closed
          source; they do. But that’s just because the majority of exciting
          opportunities are in closed source. All else equal, talented people
          will choose to work on open source.
        </p>

        <p>
          Open source is good positioning against the status quo. Marc Benioff
          in his book “Behind the Cloud” says to always position against the
          market leader (in his case Siebel, in our case Microsoft and Google)
          and if there is no market leader then position against the status quo
          (in our case, the hodgepodge of proprietary software that companies
          “run” on today).
        </p>

        <p>
          Macro is fully open source, not “open core” nor “source available”.
          Open core means that only a subset of the code is open source.
          Companies use it to be partially open while preserving a closed
          commercial offering. It’s a reasonable thing to do and we considered
          it, but I didn’t feel it was necessary in our case unlike purely
          backend self-hosted software. And since it wasn’t needed there was no
          reason to do it: it’s best to be maximally open. By the same logic, we
          are now fully open source, not source-available — where the code is
          public but the license restricts self-hosting or redistribution or
          some other restriction preventing the project from meeting OSI’s
          definition of open source. When we first made the repo available in
          2025 we started with source available, but this was always a short
          term strategy as we figured out how to be even more open (or rather,
          grew the balls necessary to make the commit, and make all our IP open
          source.)
        </p>

        <p>
          For now, Macro is AGPLv3. This is a good license for us for a few
          reasons, but mostly, it provides some protection against large
          companies and hyperscalers using Macro without contributing back to
          the ecosystem. If they wanted to offer hosted versions of Macro, or to
          self-host it for internal enterprise use, then they’d also have to
          make their customizations and plugins open source. We’d be fine with
          that. But because in most cases this is hard to do, we expect large
          self-hosters to pay for an alternative commercial partnership, and
          contribute back to the ecosystem through a combination of money,
          engineering contributions, inference compute and/or other types of
          support.
        </p>

        <p class="wos-repo">
          Check out our repo and consider contributing at{' '}
          <a href="https://github.com/macro-inc/macro">
            github.com/macro-inc/macro
          </a>
          .
        </p>
      </article>
    </div>
  );
}
