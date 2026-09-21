import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { blockData } from '../signal/blockData';
import { ModalsProvider } from './ModalsProvider';
import { TopBar } from './TopBar';
import { VideoContent } from './VideoContent';

export default function BlockVideo() {
  useBlockEntityCommands();
  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <ModalsProvider>
          <SidePanel.Layout defaultOpen={false}>
            <FileSidePanelSections />
            <div class="flex size-full min-w-0 flex-col overflow-hidden">
              <div class="relative">
                <TopBar />
              </div>
              <div class="w-full grow relative overflow-hidden">
                <VideoContent
                  videoUrl={blockData()?.videoUrl}
                  fileType={blockData()?.documentMetadata.fileType}
                />
              </div>
            </div>
          </SidePanel.Layout>
        </ModalsProvider>
      </div>
    </DocumentBlockContainer>
  );
}
