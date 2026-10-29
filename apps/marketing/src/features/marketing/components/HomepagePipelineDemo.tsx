import CrmPipelineScene from './homepage/CrmPipelineScene';
import './workspace/dummy-workspace.css';
import './homepage-pipeline-demo.css';

/** The interactive CRM scene, without a playback frame or simulated cursor. */
export default function HomepagePipelineDemo() {
  return (
    <div class="homepage-pipeline-demo workspace-demo">
      <CrmPipelineScene compact />
    </div>
  );
}
