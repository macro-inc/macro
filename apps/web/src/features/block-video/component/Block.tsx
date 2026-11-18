import { useBlockEntityCommands } from '@app/features/next-soup/actions';
import { FileSidePanelSections, SidePanel } from '@components/app/side-panel';
import { DocumentBlockContainer } from '@core/component/DocumentBlockContainer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { Show } from 'solid-js';
import { blockData } from '../signal/blockData';
import { MobileVideoHeader } from '../views/mobile/video-header';
import { VideoHeader } from '../views/video-header';
import { VideoContent } from './VideoContent';

export default function BlockVideo() {
  useBlockEntityCommands();
  return (
    <DocumentBlockContainer>
      <div class="size-full select-none overscroll-none overflow-hidden flex flex-col relative">
        <SidePanel.Layout defaultOpen={false} floating>
          <FileSidePanelSections />
          <div class="flex size-full min-w-0 flex-col overflow-hidden">
            <div class="relative">
              <Show when={isTouchDevice()} fallback={<VideoHeader />}>
                <MobileVideoHeader />
              </Show>
            </div>
            <div class="w-full grow relative overflow-hidden">
              <VideoContent
                videoUrl={blockData()?.videoUrl}
                fileType={blockData()?.documentMetadata.fileType}
              />
            </div>
          </div>
        </SidePanel.Layout>
      </div>
    </DocumentBlockContainer>
  );
}
