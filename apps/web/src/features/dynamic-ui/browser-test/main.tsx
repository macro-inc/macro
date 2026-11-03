import '../../../index.css';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, For } from 'solid-js';
import { render } from 'solid-js/web';
import { CollectionCard } from '../../agent-cards/components/collection';
import { Col, Row, View } from '../core/Layout';
import { TaskResultRow } from '../widgets/TaskResultRow';

document.documentElement.dataset.touchDevice = String(isTouchDevice());
const root = document.getElementById('root');
if (!root) throw new Error('Fixture root missing');

function Fixture() {
  const align = new URLSearchParams(location.search).has('align-start')
    ? 'start'
    : undefined;
  const [opened, setOpened] = createSignal('');
  return (
    <main class="min-h-screen bg-panel p-4 text-ink">
      <div id="results" class="w-full" style={{ 'max-width': '1100px' }}>
        <View title="Project tasks">
          <Row align={align}>
            <For each={['Project Alpha', 'Project Beta']}>
              {(project) => (
                <Col>
                  <CollectionCard
                    title={project}
                    count={3}
                    icon="task"
                    state="ready"
                  >
                    <For
                      each={[
                        'Finish the release checklist and review the documentation before publishing the next update',
                        'ReviewTheEntireUnbrokenTaskTitleWithoutClippingOrHorizontalOverflowForNarrowSplitPanes',
                        'Ship it',
                      ]}
                    >
                      {(title) => (
                        <TaskResultRow
                          title={title}
                          icon={<span aria-hidden="true">○</span>}
                          metadata={
                            <div class="flex items-center gap-1">
                              <span class="rounded-full border border-edge-muted px-2">
                                In progress
                              </span>
                              <span class="rounded-full border border-edge-muted px-2">
                                High priority
                              </span>
                              <span class="rounded-full border border-edge-muted px-2">
                                Assigned
                              </span>
                            </div>
                          }
                          timestamp={<span>2 hours ago</span>}
                          onOpen={() => setOpened(title)}
                        />
                      )}
                    </For>
                  </CollectionCard>
                </Col>
              )}
            </For>
          </Row>
        </View>
      </div>
      <output aria-label="Opened task">{opened()}</output>
    </main>
  );
}
render(() => <Fixture />, root);
