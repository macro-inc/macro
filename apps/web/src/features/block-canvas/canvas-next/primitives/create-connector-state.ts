import {
  type ConnectorGesture,
  type ConnectorStyle,
  type ConnectorTarget,
  connectorStyleCommand,
  createConnectorInteraction,
  type GraphicsEditor,
  setConnectorCommand,
} from '@macro-inc/graphics';
import { batch, createSignal, onCleanup } from 'solid-js';

export function createConnectorState(editor: GraphicsEditor) {
  const [gesture, setGesture] = createSignal<ConnectorGesture>();
  const [target, setTarget] = createSignal<ConnectorTarget>();
  const [defaults, setDefaults] = createSignal<ConnectorStyle>({
    route: 'stepped',
    startHead: 'none',
    endHead: 'arrow',
  });
  const interaction = createConnectorInteraction({
    getDocument: () => editor.document,
    commit: (item) => editor.execute(setConnectorCommand, item),
    onChange: () =>
      batch(() => {
        setGesture(interaction.getState());
        setTarget(interaction.getTarget());
      }),
  });
  onCleanup(interaction.cancel);
  return {
    interaction,
    gesture,
    target,
    defaults,
    preview: () => (gesture() ? interaction.getPreviewDocument() : undefined),
    preset(tool: 'arrow' | 'line' | 'connector') {
      setDefaults({
        route: tool === 'connector' ? 'stepped' : 'straight',
        startHead: 'none',
        endHead: tool === 'line' ? 'none' : 'arrow',
      });
    },
    style(patch: Partial<ConnectorStyle>) {
      setDefaults((value) => ({ ...value, ...patch }));
      editor.execute(connectorStyleCommand, patch);
    },
  };
}
