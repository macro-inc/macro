import { connectEmail, useEmailLinksStatus } from '@app/signal/emailAuth';
import { IconButton } from '@core/component/IconButton';
import { toast } from '@core/component/Toast/Toast';
import { fileSelector } from '@core/directive/fileSelector';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import type { ViewId } from '@core/types/view';
import CloseIcon from '@icon/regular/x.svg';
import { authServiceClient } from '@service-auth/client';
import { useTutorialCompleted } from '@service-gql/client';
import { For, type JSX, Match, Show, Switch } from 'solid-js';
import { HotkeyExample, type HotkeyExampleProps } from './HotkeyExample';
import { useSplitPanelOrThrow } from './split-layout/layoutUtils';

false && fileSelector;

export function HelpDrawer(props: { view?: ViewId }) {
  const emailActive = useEmailLinksStatus();

  return (
    <Switch>
      <Match when={props.view === 'emails' && !emailActive()}>
        <HelpDrawerInner
          title={'Macro is better with email.'}
          subtitle={
            <span>
              Connect your email to the rest of your workspace. Use{' '}
              <span class="font-mono bg-edge/20 rounded-xs md-inline-code p-0.3">
                @mentions
              </span>{' '}
              to give email recipients access to anything in Macro.
            </span>
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.email,
              ],
            },
          ]}
          cta={{
            label: 'Connect email',
            onClick: connectEmail,
          }}
        />
      </Match>
      <Match when={props.view === 'emails' && emailActive()}>
        <HelpDrawerInner
          title={'Email is better with Macro.'}
          subtitle={
            <span>
              Use{' '}
              <span class="font-mono bg-edge/20 rounded-xs md-inline-code p-0.3">
                @mentions
              </span>{' '}
              to give email recipients access to anything in Macro. Ask AI to
              search your emails.
            </span>
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.email,
              ],
            },
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.message,
              ],
            },
            {
              hotkeyTokenSequence: [TOKENS.global.toggleRightPanel],
            },
          ]}
        />
      </Match>
      <Match when={props.view === 'inbox'}>
        <HelpDrawerInner
          title={'Your unified inbox.'}
          subtitle={
            'All your emails, messages, notifications, tasks in one place. Triage everything. No context switching.'
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.email,
              ],
            },
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.message,
              ],
            },
          ]}
          cta={
            !emailActive()
              ? {
                  label: 'Connect email',
                  onClick: connectEmail,
                }
              : undefined
          }
        />
      </Match>
      <Match when={props.view === 'comms'}>
        <HelpDrawerInner
          title={'Message teammates.'}
          subtitle={
            <span>
              Type{' '}
              <span class="bg-edge/20 rounded-xs md-inline-code p-0.3">@</span>{' '}
              to reference files, people, tasks, etc. Files are automatically
              shared when you press send.
            </span>
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.message,
              ],
            },
          ]}
        />
      </Match>
      <Match when={props.view === 'docs'}>
        <HelpDrawerInner
          title={'Documents. Interlinked.'}
          subtitle={
            <span>
              Type{' '}
              <span class="bg-edge/20 rounded-xs md-inline-code p-0.3">@</span>{' '}
              to reference files, people, tasks, etc. Collaborate on documents
              with your team.
            </span>
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.note,
              ],
            },
          ]}
        />
      </Match>
      <Match when={props.view === 'ai'}>
        <HelpDrawerInner
          title={'Ask AI anything.'}
          subtitle={
            <span>
              AI has secure access to your entire workspace. You can feed it
              context by{' '}
              <span class="font-mono bg-edge/20 rounded-xs md-inline-code p-0.3">
                @mentioning
              </span>{' '}
              any of your files, notes, contacts, emails, channels, folders, or
              tasks.
            </span>
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.chat,
              ],
            },
            {
              hotkeyTokenSequence: [TOKENS.global.toggleBigChat],
            },
          ]}
        />
      </Match>
      <Match when={props.view === 'folders'}>
        <HelpDrawerInner
          title={'All your files, organized.'}
          subtitle={
            "Drag and drop entire folders. Once they're in Macro, you can share them with your team."
          }
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [
                TOKENS.global.createCommand,
                TOKENS.create.project,
              ],
            },
          ]}
        />
      </Match>
      <Match when={true}>
        <HelpDrawerInner
          title={'Welcome to Macro.'}
          subtitle={'We use hotkeys to move fast.'}
          hotkeyExamples={[
            {
              hotkeyTokenSequence: [TOKENS.global.commandMenu],
            },
            {
              hotkeyTokenSequence: [TOKENS.global.createNewSplit],
            },
            {
              hotkeyTokenSequence: [TOKENS.global.toggleRightPanel],
            },
            {
              hotkeyTokenSequence: [TOKENS.global.createCommand],
            },
          ]}
        />
      </Match>
    </Switch>
  );
}

export interface HelpDrawerInnerProps {
  title: string;
  subtitle?: JSX.Element | string;
  hotkeyExamples?: HotkeyExampleProps[];
  cta?: {
    label: string;
    onClick: () => void;
  };
}

export function HelpDrawerInner(props: HelpDrawerInnerProps) {
  const splitPanelContext = useSplitPanelOrThrow();
  const {
    unifiedListContext: { setShowHelpDrawer },
  } = splitPanelContext;
  const tuturialComplete = useTutorialCompleted();
  const hideAllHelpDrawers = () => {
    setShowHelpDrawer(new Set<string>());
    toast.success('Press ? to re-open the help drawer.');
    if (!tuturialComplete()) {
      authServiceClient
        .patchUserTutorial({ tutorialComplete: true })
        .catch(console.error);
    }
  };
  return (
    <div class="w-full shrink-0 flex flex-col text-ink-muted relative border-t border-edge-muted">
      <div class="absolute pattern-edge pattern-diagonal-4 opacity-100 w-full h-4 top-0 -translate-y-[calc(100%_+_1px)] mask-t-from-0" />
      <div class="content bg-dialog min-h-[16rem]">
        <div class="absolute top-3 right-3">
          <IconButton
            icon={CloseIcon}
            theme="clear"
            size="sm"
            tooltip={{ label: 'Close' }}
            onClick={hideAllHelpDrawers}
          />
        </div>
        <div class="panel h-full flex items-center justify-start max-w-[80rem]">
          <div class="left-side h-full py-8 px-4 basis-1/2 border-r border-edge-muted">
            <p class="text-2xl font-medium">{props.title}</p>
            <Show when={props.subtitle}>
              <div class="leading-[1.35] text-base text-balance">
                <div class="pt-3">{props.subtitle}</div>
              </div>
            </Show>
            <Show when={props.cta}>
              {(cta) => (
                <div class="w-full flex justify-start pt-4">
                  <button
                    onMouseDown={cta().onClick}
                    class="cta py-2 px-2 bg-accent/75 text-panel"
                  >
                    <span class="font-medium">{cta().label.toUpperCase()}</span>
                  </button>
                </div>
              )}
            </Show>
          </div>
          <Show
            when={props.hotkeyExamples && !(isTouchDevice && isMobileWidth())}
          >
            <div class="hotkey-examples-container px-4 py-8 h-full basis-1/2">
              <div class="grid grid-cols-[min-content_1fr] gap-x-8 gap-y-4">
                <For each={props.hotkeyExamples}>
                  {(hotkeyExample) => (
                    <HotkeyExample
                      hotkeyTokenSequence={hotkeyExample.hotkeyTokenSequence}
                      subtitle={hotkeyExample.subtitle}
                    />
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
