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
      >
        <PaperFeatureGraphic
          height={396}
          mobileHeight={380}
          label="Claude is asked for next quarter’s forecast. Its cursor moves down the sheet, filling in each team’s number and a total, while a teammate works in another cell."
          mobile={<SheetAgentDemo compact />}
        >
          <SheetAgentDemo />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection
        id="spreadsheets-detail-2"
        title={sections[1].title}
        description={sections[1].description}
      >
        <PaperFeatureGraphic
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
      >
        <PaperFeatureGraphic
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
      >
        <PaperFeatureGraphic
          height={196}
          mobileHeight={300}
          label="An Excel workbook opens as an editable Macro sheet with its three sheets, and downloads back as Excel or CSV."
        >
          <SheetImportGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
    </>
  );
}
