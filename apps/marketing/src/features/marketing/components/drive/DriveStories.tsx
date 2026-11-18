import { workspaceFeatures } from '../../core/workspace-features';
import { DocumentSharingDemo } from '../documents/DocumentSharingDemo';
import { FeaturePageSection } from '../FeaturePage';
import { PaperFeatureGraphic } from '../paper/PaperFeatureGraphic';
import { DriveAgentDemo, DriveRecordFilesDemo } from './DriveDemos';
import {
  DriveArrivalsGraphic,
  DriveFileTypesGraphic,
  DriveLibraryGraphic,
  DriveTagsGraphic,
  DriveViewsGraphic,
} from './DriveGraphics';

/**
 * The Drive page: where files come from, sharing, file types, agents, folders
 * and databases, tags, records, and the skills and snippets kept beside them.
 */
export function DriveStories() {
  const drive = workspaceFeatures.drive;
  const sections = drive.sections;
  if (!sections) return null;
  const copy = (index: number) => ({
    id: `drive-detail-${index + 1}`,
    title: sections[index].title,
    description: sections[index].description,
  });
  const glass = { tone: drive.tone, glassFrame: true } as const;
  return (
    <>
      <FeaturePageSection
        id="drive-workspace"
        title={drive.heading}
        description={drive.detail}
        demo={glass}
      >
        <PaperFeatureGraphic
          backdrop={false}
          height={398}
          mobileHeight={436}
          label="An email attachment and a file posted in a channel each appear as a new row in Drive, marked with where it came from."
        >
          <DriveArrivalsGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection {...copy(0)} demo={{ tone: drive.tone }}>
        <DocumentSharingDemo />
      </FeaturePageSection>
      <FeaturePageSection {...copy(1)} demo={glass}>
        <PaperFeatureGraphic
          backdrop={false}
          interactive
          height={334}
          mobileHeight={314}
          label="One viewer with a tab for each open file: a PDF, a presentation, a Figma file, and a video."
        >
          <DriveFileTypesGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection {...copy(2)} demo={{ tone: 'agents' }}>
        <DriveAgentDemo />
      </FeaturePageSection>
      <FeaturePageSection {...copy(3)} demo={glass}>
        <PaperFeatureGraphic
          backdrop={false}
          interactive
          height={334}
          mobileHeight={314}
          label="The same files shown as nested folders and as a database with type, tag, and creator properties."
        >
          <DriveViewsGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection {...copy(4)} demo={glass}>
        <PaperFeatureGraphic
          backdrop={false}
          height={246}
          mobileHeight={226}
          label="Drive filtered to the Customers tag, listing three files from email and a channel."
        >
          <DriveTagsGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
      <FeaturePageSection {...copy(5)} demo={{ tone: 'crm' }}>
        <DriveRecordFilesDemo />
      </FeaturePageSection>
      <FeaturePageSection {...copy(6)} demo={glass}>
        <PaperFeatureGraphic
          backdrop={false}
          height={250}
          mobileHeight={230}
          label="A Drive folder holding a skill and a snippet beside a checklist and a contract."
        >
          <DriveLibraryGraphic />
        </PaperFeatureGraphic>
      </FeaturePageSection>
    </>
  );
}
