import { workspaceFeatures } from '../../core/workspace-features';
import { FeaturePageSection } from '../FeaturePage';
import HomepageProductPreview from '../homepage/HomepageProductPreview';
import { PaperFeatureGraphic } from '../paper/PaperFeatureGraphic';
import {
  SheetAgentDemo,
  SheetChartGraphic,
  SheetCrmGraphic,
  SheetImportGraphic,
} from './SheetStories';

/** The Spreadsheets page: the live sheet, then agents, CRM, charts, and Excel. */
export function SpreadsheetStories() {
  const sheets = workspaceFeatures.spreadsheets;
  const sections = sheets.sections;
  if (!sections) return null;
  return (
    <>
      <FeaturePageSection
        id="spreadsheets-workspace"
        title={sheets.heading}
        description={sheets.detail}
        demo={{ tone: sheets.tone, glassFrame: false }}
      >
        <div class="workspace-feature-preview">
          <HomepageProductPreview kind="spreadsheet" />
        </div>
      </FeaturePageSection>
      <FeaturePageSection
        id="spreadsheets-detail-1"
        title={sections[0].title}
        description={sections[0].description}
        demo={{ tone: sheets.tone, glassFrame: true }}
      >
        <PaperFeatureGraphic
          backdrop={false}
          height={356}
          mobileHeight={340}
          label="Claude builds next quarter’s forecast in the sheet. Its cursor moves down the sheet, filling in each team’s number and a total, while a teammate works in another cell."
          mobile={<SheetAgentDemo compact />}
        >
          <SheetAgentDemo />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="spreadsheets-detail-2"
        title={sections[1].title}
        description={sections[1].description}
        demo={{ tone: sheets.tone, glassFrame: true }}
      >
        <PaperFeatureGraphic
          backdrop={false}
          interactive
          height={430}
          mobileHeight={420}
          label="A renewals sheet whose company cells are CRM records. The selected company shows its stage, owner, last email, next call, and open task."
          mobile={<SheetCrmGraphic compact />}
        >
          <SheetCrmGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="spreadsheets-detail-3"
        title={sections[2].title}
        description={sections[2].description}
        demo={{ tone: sheets.tone, glassFrame: true }}
      >
        <PaperFeatureGraphic
          backdrop={false}
          height={414}
          mobileHeight={580}
          label="A sheet of spend by team with a total formula, a bar chart of the selected cells, and a comment thread on one cell."
          mobile={<SheetChartGraphic compact />}
        >
          <SheetChartGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="spreadsheets-detail-4"
        title={sections[3].title}
        description={sections[3].description}
        demo={{ tone: sheets.tone, glassFrame: true }}
      >
        <PaperFeatureGraphic
          backdrop={false}
          height={384}
          mobileHeight={400}
          label="An uploaded Excel workbook open in Macro with its three sheets as tabs and an Edit in Macro action that makes an editable copy."
          mobile={<SheetImportGraphic compact />}
        >
          <SheetImportGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
    </>
  );
}
