import { workspaceFeatures } from '../../core/workspace-features';
import { FeaturePageSection } from '../FeaturePage';
import HomepageProductPreview from '../homepage/HomepageProductPreview';
import { NotionImportGraphic } from './NotionImportGraphic';
import { PaperDatabaseFields } from './PaperDatabaseFields';
import { PaperDatabaseFieldsMobile } from './PaperDatabaseFieldsMobile';
import { PaperDatabaseQuery } from './PaperDatabaseQuery';
import { PaperFeatureGraphic } from './PaperFeatureGraphic';

export function DatabaseStories() {
  const database = workspaceFeatures.databases;
  const sections = database.sections;
  if (!sections) return null;
  return (
    <>
      <FeaturePageSection
        id="databases-workspace"
        title={database.heading}
        description={database.detail}
      >
        <PaperFeatureGraphic
          label="A database table with typed columns. Callouts point to a column’s type and to opening a record."
          mobile={<PaperDatabaseFieldsMobile />}
        >
          <PaperDatabaseFields />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="databases-detail-1"
        title={sections[0].title}
        description={sections[0].description}
        demo={{
          tone: database.tone,
          message: { person: 'julia', text: database.message },
        }}
      >
        <div class="workspace-feature-preview">
          <HomepageProductPreview kind="databases" />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="databases-detail-2"
        title={sections[1].title}
        description={sections[1].description}
      >
        <PaperFeatureGraphic label="Ask Macro to chart database records by stage and see the results as a bar chart.">
          <PaperDatabaseQuery />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="databases-detail-3"
        title={sections[2].title}
        description={sections[2].description}
      >
        <NotionImportGraphic />
      </FeaturePageSection>
    </>
  );
}
