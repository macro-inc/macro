import Code from '@phosphor/code.svg';
import Plus from '@phosphor/plus.svg';
import Lightning from '@phosphor-fill/lightning-fill.svg';
import { Button, Dropdown } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ChannelComposer } from '../email/frozen/ChannelComposer';
import { ModelCatalogPicker } from '../workspace/frozen/model-picker/ModelCatalogPicker';
import { AGENT_MODELS, AGENT_PLACEHOLDER } from './agentDemoData';

/** Presentation adapted from agents-view/{ChatComposer,AgentPicker,ModelSelector}
 * at 40ceda68. A running session selects a model; a new session also selects an
 * agent. All choices and draft text belong to this local sample. */
export function AgentComposer(props: {
  onSend: (text: string) => void;
  newConversation?: boolean;
  model?: string;
  onModelChange?: (model: string) => void;
  mode?: 'work' | 'code';
  onModeChange?: (mode: 'work' | 'code') => void;
  onCreateAgent?: () => void;
}) {
  const [localModel, setModel] = createSignal(AGENT_MODELS[0].id);
  const model = () => props.model ?? localModel();
  const [agent, setAgent] = createSignal('Cursor');
  const [saved, setSaved] = createSignal(false);
  const [fast, setFast] = createSignal(false);
  const [repository, setRepository] = createSignal('Choose repository');
  const coding = () => props.newConversation && props.mode === 'code';
  return (
    <div class="agent-composer">
      <ChannelComposer
        agent
        richMentions
        attachmentIcon={<Plus />}
        label="Message the agent"
        placeholder={
          coding() ? 'Describe what you want to build' : AGENT_PLACEHOLDER
        }
        accessory={
          <div class="flex min-w-0 items-center gap-1">
            <ModelCatalogPicker
              childrenAfter
              value={model()}
              options={AGENT_MODELS}
              onSelect={(id) => {
                setModel(id);
                props.onModelChange?.(id);
                setSaved(false);
                props.onModeChange?.('work');
              }}
              triggerLabel={
                coding() || saved()
                  ? `${agent()} · ${AGENT_MODELS.find((m) => m.id === model())?.label}`
                  : undefined
              }
              ariaLabel={props.newConversation ? 'Agent' : 'Model'}
              placement="top-end"
              triggerClass="h-[33.75px] min-w-0 max-w-full gap-[5.625px] rounded-full border-0 bg-transparent hover:bg-hover px-[7.5px] text-base font-normal text-ink-muted [&_svg]:size-[15px]"
            >
              <Show when={props.newConversation}>
                <Dropdown.Group>
                  <Dropdown.GroupLabel>Agents</Dropdown.GroupLabel>
                  <Dropdown.Item
                    onSelect={() => {
                      setAgent('Customer follow-ups');
                      setSaved(true);
                      props.onModeChange?.('work');
                    }}
                  >
                    Customer follow-ups
                  </Dropdown.Item>
                </Dropdown.Group>
                <Dropdown.Group>
                  <Dropdown.GroupLabel>Coding agents</Dropdown.GroupLabel>
                  <Dropdown.Item
                    onSelect={() => {
                      setAgent('Cursor');
                      setSaved(false);
                      props.onModeChange?.('code');
                    }}
                  >
                    <Code class="size-4" /> Cursor
                  </Dropdown.Item>
                  <Dropdown.Item
                    onSelect={() => {
                      setAgent('Claude Code');
                      setSaved(false);
                      props.onModeChange?.('code');
                    }}
                  >
                    <Code class="size-4" /> Claude Code
                  </Dropdown.Item>
                </Dropdown.Group>
                <Show when={props.onCreateAgent}>
                  <Dropdown.Item onSelect={() => props.onCreateAgent?.()}>
                    <Plus class="size-4" /> Create agent
                  </Dropdown.Item>
                </Show>
              </Show>
            </ModelCatalogPicker>
            <Show
              when={
                props.newConversation &&
                !coding() &&
                model() === 'claude-opus-5-5'
              }
            >
              <Button
                variant="ghost"
                size="icon-composer"
                label={`Fast mode ${fast() ? 'on' : 'off'} · 2× AI usage`}
                aria-pressed={fast()}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setFast(!fast())}
                class={fast() ? 'text-accent bg-accent/10' : 'text-ink-muted'}
              >
                <Lightning class="size-4" />
              </Button>
            </Show>
          </div>
        }
        onSend={props.onSend}
      />
      <Show when={coding()}>
        <div class="agent-repository-bar">
          <Dropdown placement="top-start">
            <Dropdown.Trigger variant="ghost" size="sm">
              {repository()}
            </Dropdown.Trigger>
            <Dropdown.Content portalScope="local">
              <Dropdown.Item
                onSelect={() => setRepository('Choose repository')}
              >
                Choose automatically
              </Dropdown.Item>
              <Dropdown.Item
                onSelect={() => setRepository('launch-team/workspace')}
              >
                launch-team/workspace
              </Dropdown.Item>
            </Dropdown.Content>
          </Dropdown>
          <Show when={repository() !== 'Choose repository'}>
            <span>main</span>
          </Show>
        </div>
      </Show>
    </div>
  );
}
