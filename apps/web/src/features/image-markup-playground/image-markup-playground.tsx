import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { StaticSplitLabel } from '@components/app/split-layout/components/SplitLabel';
import { ImageMarkupView } from './views/image-markup-view';

export default function ImageMarkupPlayground() {
  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel label="Image markup playground" />
      </SplitHeaderLeft>
      <ImageMarkupView />
    </>
  );
}
