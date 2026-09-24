import { createNestedTestScene } from './core/test-scenes';
import GraphicsPlayground from './graphics-playground';

export default function NestedScenePlayground() {
  return (
    <GraphicsPlayground
      seedScene={createNestedTestScene}
      label="Nested scene playground"
      inspector
    />
  );
}
