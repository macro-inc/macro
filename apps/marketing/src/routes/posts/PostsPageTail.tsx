import { HomeSectionRule } from '../../app/components/sections/HomeSectionRule';
import { SectionFinalCta } from '../../app/components/sections/SectionFinalCta';
import { SectionMoreFeatures } from '../../app/components/sections/SectionMoreFeatures';

/** Homepage-style closing CTA + footer shared across all blog pages. */
export function PostsPageTail(props: { ctaButtonName: string }) {
  return (
    <>
      <HomeSectionRule />
      <div class="posts-home-cta-wrap posts-shell">
        <SectionFinalCta
          googleButtonName={props.ctaButtonName}
          demoButtonName="posts_book_demo"
          mobileButtonName={props.ctaButtonName}
        />
      </div>
      <div class="posts-page-footer posts-shell">
        <SectionMoreFeatures currentPath="/posts" footerOnly />
      </div>
    </>
  );
}
