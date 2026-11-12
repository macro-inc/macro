import ArrowRight from '@icon/system/regular/arrow-right.svg';
import './homepage-feature-details.css';

export type ProductPagePath =
  | '/email'
  | '/channels'
  | '/documents'
  | '/tasks'
  | '/agents'
  | '/crm';

/** Open the full product page through a normal same-tab link. */
export function HomepageFeatureDetails(props: {
  title: string;
  path: ProductPagePath;
}) {
  return (
    <div class="homepage-feature-more workspace-demo">
      <a href={props.path}>
        Learn about{' '}
        {props.title === 'CRM' ? props.title : props.title.toLowerCase()}
        <ArrowRight aria-hidden="true" />
      </a>
    </div>
  );
}
