import { useGlobalBlockOrchestrator } from '@app/component/GlobalAppState';
import { useOpenChatForAttachment } from '@block-chat/client';
import { withAnalytics } from '@coparse/analytics';
import type { BlockName } from '@core/block';
import { type Completion, streamCompletion } from '@core/client/completion';
import { rightbarChatId } from '@core/signal/rightbar';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import BulletPointsIcon from '@phosphor-icons/core/regular/list-bullets.svg?component-solid';
import PencilIcon from '@phosphor-icons/core/regular/pencil.svg?component-solid';
import QuoteIcon from '@phosphor-icons/core/regular/quotes.svg?component-solid';
import SparkleIcon from '@phosphor-icons/core/regular/sparkle.svg?component-solid';
import TranslateIcon from '@phosphor-icons/core/regular/translate.svg?component-solid';
import type { ExtractionStatusType } from '@service-cognition/types';
import { createCallback } from '@solid-primitives/rootless';
import { toast } from 'core/component/Toast/Toast';
import {
  type Accessor,
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { CircleSpinner } from '../CircleSpinner';
import {
  DropdownMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '../Menu';
import { TextButton } from '../TextButton';

const SUPPORTED_LANGUAGES = [
  'English',
  'Spanish',
  'French',
  'German',
  'Chinese',
  'Japanese',
  'Russian',
  'Portuguese',
  'Italian',
  'Arabic',
  'Dutch',
  'Korean',
  'Turkish',
  'Hindi',
];

export const PROMPT_OPTIONS = {
  explain: (selectedText: string) =>
    `Explain the following text: "${selectedText}", in 2-3 sentences.`,
  bullet: (selectedText: string) =>
    `Generate bullet points for the following text: "${selectedText}", generate max 7 bullet points.`,
  translate: (selectedText: string, language: string) =>
    `Translate the following text to ${language}: "${selectedText}".`,
  rewrite: (instructions: string | undefined, selectedText: string) =>
    `${
      instructions
        ? `Rewrite the text in the following manner: ${instructions}.`
        : `Fix grammatical and spelling errors ONLY. `
    }
This rewritten text will directly replace the selected text, so only provide the rewritten text with no introduction, explanation, or quotation marks.
The provided text is written in Markdown syntax, maintain the markdown syntax.
Respect the XML components when possible, except for tables.
Only paragraphs and styled texts are allowed within lists. No complex objects should live within lists.
Rewrite the following text: "${selectedText}".`,
};

export type PromptType = keyof typeof PROMPT_OPTIONS;

type PromptTypeDisplay = {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  text: string;
};

const PromptTypeDisplay: Record<PromptType, PromptTypeDisplay> = {
  explain: {
    icon: SparkleIcon,
    text: 'Explain',
  },
  bullet: {
    icon: BulletPointsIcon,
    text: 'Bullet points',
  },
  rewrite: {
    icon: PencilIcon,
    text: 'Rewrite',
  },
  translate: {
    icon: TranslateIcon,
    text: 'Translate',
  },
} as const;

type DefaultAction = {
  type: PromptType;
  language?: string;
};

type UserPreferences = {
  defaultAction: DefaultAction;
  autoRun: boolean;
};

const defaultPreferences: UserPreferences = {
  defaultAction: { type: 'explain', language: 'English' },
  autoRun: false,
};

function getPreferencesKey(blockName: BlockName) {
  return `ask-ai-preferences-${blockName}`;
}

function loadPreferences(blockName: BlockName): UserPreferences {
  const key = getPreferencesKey(blockName);
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      return { ...defaultPreferences, ...JSON.parse(raw) };
    } catch {
      console.error(`${key} does not exist in local storage.`);
    }
  }
  return { ...defaultPreferences };
}

function savePreferences(blockName: BlockName, prefs: UserPreferences) {
  const key = getPreferencesKey(blockName);
  localStorage.setItem(key, JSON.stringify(prefs));
}

function useAskAiPreferences(blockName: BlockName) {
  const [preferences, setPreferences] = createStore<UserPreferences>(
    loadPreferences(blockName)
  );
  createEffect(() => {
    savePreferences(blockName, preferences);
  });
  return [preferences, setPreferences] as const;
}

export function AskAi(props: {
  attachmentId: string;
  blockName: BlockName;
  setCompletion: (completion: Completion | undefined) => void;
  setCompletionType?: (
    type: 'explain' | 'bullet' | 'translate' | 'rewrite' | undefined
  ) => void;
  selectedText: string;
  canEdit?: boolean;
  contentSize?: () => number;
  selectedNodesText?: string;
  registerRewriteMethod?: (method: (instructions: string) => void) => void;
}) {
  const blockOrchestrator = useGlobalBlockOrchestrator();
  const [preferences, setPreferences] = useAskAiPreferences(props.blockName);
  const getChatId = () => rightbarChatId();

  const BlockAllowedPrompts = Object.keys(PromptTypeDisplay).filter(
    (_key: string) => {
      switch (_key) {
        case 'rewrite':
          return ['md'].includes(props.blockName) && props.canEdit;
        default:
          return true;
      }
    }
  );

  const isPlainText = () => {
    return ['md', 'canvas', 'code'].includes(props.blockName);
  };

  // TODO
  const attachmentStatus: Accessor<ExtractionStatusType> = () => 'complete';

  createEffect(() => {
    if (
      preferences.autoRun &&
      attachmentStatus() !== 'incomplete' &&
      attachmentStatus() !== 'empty'
    ) {
      executeDefaultAction();
    }
  });

  const updatePreferences = (newPrefs: Partial<UserPreferences>) => {
    setPreferences((prev) => ({ ...prev, ...newPrefs }));
  };

  const updateDefaultAction = (newDefault: DefaultAction) => {
    updatePreferences({ defaultAction: newDefault });
  };

  const { track, TrackingEvents } = withAnalytics();

  const sendCompletion = (
    prompt: string,
    attachmentId?: string,
    selectedText?: string
  ) => {
    streamCompletion(
      {
        prompt,
        attachmentId,
        selectedText,
      },
      props.setCompletion
    );
  };

  const hasSufficientContent = () => {
    // plain text (md, canvas, code)
    if (isPlainText() && props.contentSize) {
      return props.contentSize() >= 500;
    }

    // text extractions (pdf, docx)
    return attachmentStatus() === 'complete';
  };

  const sendBasicCompletion = (type: 'bullet' | 'explain' | 'rewrite') => {
    track(TrackingEvents.POPUP.ASKAI.SELECT, {
      option: type,
    });
    if (type === 'rewrite') {
      handleRewrite();
    } else {
      const prompt: string = PROMPT_OPTIONS[type](props.selectedText!);
      sendCompletion(prompt, props.attachmentId, props.selectedText);
      props.setCompletionType?.(type);
    }
    if (!hasSufficientContent()) {
      toast.alert(
        'Document contains insufficient content. AI explanations may be limited.'
      );
    }
  };

  const sendTranslationCompletion = (language: string) => {
    let prompt = PROMPT_OPTIONS.translate(props.selectedText!, language);
    track(TrackingEvents.POPUP.ASKAI.SELECT, {
      option: 'translate',
      language,
    });
    sendCompletion(prompt, undefined, undefined);
    props.setCompletionType?.('translate');
  };

  const _askAIicon = () => {
    if (isPlainText()) {
      return QuoteIcon;
    }
    if (attachmentStatus() === 'incomplete') {
      return CircleSpinner;
    }
    return QuoteIcon;
  };

  const actionIcon = () => {
    if (!isPlainText() && attachmentStatus() === 'incomplete') {
      return CircleSpinner;
    }
    switch (preferences.defaultAction.type) {
      case 'explain':
        return SparkleIcon;
      case 'bullet':
        return BulletPointsIcon;
      case 'translate':
        return TranslateIcon;
      default:
        return SparkleIcon;
    }
  };

  const openChatForAttachment = useOpenChatForAttachment();
  const _openWithQuote = async () => {
    let selectedText = props.selectedText!;
    track(TrackingEvents.POPUP.ASKAI.REFERENCE_IN_CHAT);

    await openChatForAttachment({
      attachmentId: props.attachmentId,
    });
    if (!selectedText) return;

    const chatId = getChatId();
    if (!chatId) return;

    const blockHandle = await blockOrchestrator.getBlockHandle(chatId, 'chat');

    if (!blockHandle) {
      console.log('NO BLOCK HANDLE FOUND');
      return;
    }

    await blockHandle.setQuote(selectedText);

    if (!hasSufficientContent()) {
      toast.alert(
        'Document contains insufficient content. AI responses may be limited.'
      );
    }
  };

  const executeDefaultAction = () => {
    if (!BlockAllowedPrompts.includes(preferences.defaultAction.type)) {
      sendBasicCompletion('explain');
      return;
    }

    if (
      preferences.defaultAction.type === 'translate' &&
      preferences.defaultAction.language
    ) {
      sendTranslationCompletion(preferences.defaultAction.language);
    } else {
      sendBasicCompletion(
        preferences.defaultAction.type as 'bullet' | 'explain' | 'rewrite'
      );
    }
  };

  const defaultActionLabel = () => {
    if (!BlockAllowedPrompts.includes(preferences.defaultAction.type)) {
      return 'Explain';
    }

    if (preferences.defaultAction.type === 'translate') {
      return `Translate to ${preferences.defaultAction.language ?? 'English'}`;
    }
    switch (preferences.defaultAction.type) {
      case 'explain':
        return 'Explain';
      case 'bullet':
        return 'Bullet Points';
      case 'rewrite':
        return 'Rewrite';
    }
  };

  const [triggerRef, setTriggerRef] = createSignal<HTMLDivElement>();
  const [open, setOpen] = createSignal(false);

  // prevents Document.tsx handlers from interfering
  let ref!: HTMLDivElement;

  const hasAttachment = createMemo(() => {
    if (isPlainText()) {
      return true;
    }
    return (
      attachmentStatus() === 'insufficient' || attachmentStatus() === 'complete'
    );
  });

  const handleRewrite = () => {
    props.setCompletionType?.('rewrite');
    props.setCompletion(undefined);
  };

  if (props.registerRewriteMethod) {
    props.registerRewriteMethod(
      createCallback((input: string) => {
        const selectedText = props.selectedNodesText ?? props.selectedText;
        const prompt: string = PROMPT_OPTIONS['rewrite'](selectedText, input);
        sendCompletion(prompt, props.attachmentId, selectedText);
      })
    );
  }

  return (
    <div
      ref={ref}
      class="flex gap-1"
      // prevents Document.tsx handlers from interfering
      on:mousemove={(e) => {
        e.stopPropagation();
      }}
      on:mouseup={(e) => {
        e.stopPropagation();
      }}
    >
      {/* TODO: implement ask ai button (M-4765) */}
      {/* <TextButton */}
      {/*   theme="clear" */}
      {/*   icon={askAIicon()} */}
      {/*   onClick={openWithQuote} */}
      {/*   disabled={!hasAttachment()} */}
      {/*   text="Ask AI" */}
      {/* /> */}
      <DropdownMenu
        gutter={7}
        shift={-5}
        open={open()}
        onOpenChange={setOpen}
        getAnchorRect={() => triggerRef()?.getBoundingClientRect()}
      >
        <TextButton
          theme="clear"
          icon={actionIcon()}
          onClick={executeDefaultAction}
          disabled={!hasAttachment()}
          text={defaultActionLabel()}
          onOptionClick={() => setOpen((prev) => !prev)}
          ref={setTriggerRef}
          showChevron
        />
        <DropdownMenu.Portal>
          <DropdownMenuContent class="w-72">
            <Show when={props.canEdit && props.blockName === 'md'}>
              <MenuItem
                text="Rewrite"
                icon={PencilIcon}
                onClick={() => handleRewrite()}
              />
            </Show>
            <MenuItem
              text="Explain"
              icon={SparkleIcon}
              onClick={() => sendBasicCompletion('explain')}
            />
            <MenuItem
              text="Bullet Points"
              icon={BulletPointsIcon}
              onClick={() => sendBasicCompletion('bullet')}
            />
            <MenuItem
              text="Translate"
              icon={TranslateIcon}
              onClick={() =>
                sendTranslationCompletion(
                  preferences.defaultAction.language ?? 'English'
                )
              }
            />
            <MenuSeparator />
            <MenuItem
              text="Run automatically"
              selectorType="checkbox"
              checked={preferences.autoRun}
              onClick={() =>
                updatePreferences({ autoRun: !preferences.autoRun })
              }
              closeOnSelect={false}
            />
            <MenuSeparator />
            <DropdownMenu.Sub gutter={4}>
              <SubTrigger text="Set default action" />
              <DropdownMenu.Portal>
                <DropdownMenuContent submenu class="w-44">
                  <DropdownMenu.RadioGroup
                    value={preferences.defaultAction.type}
                    class="w-full"
                  >
                    <For each={BlockAllowedPrompts}>
                      {(key) => (
                        <MenuItem
                          value={key}
                          selectorType="radio"
                          text={PromptTypeDisplay[key as PromptType].text}
                          groupValue={preferences.defaultAction.type}
                          onClick={() =>
                            updateDefaultAction({
                              type: key as PromptType,
                              language: preferences.defaultAction.language,
                            })
                          }
                        />
                      )}
                    </For>
                  </DropdownMenu.RadioGroup>
                </DropdownMenuContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
            <DropdownMenu.Sub gutter={4}>
              <SubTrigger text="Set translation language" />
              <DropdownMenu.Portal>
                <DropdownMenuContent submenu class="w-44">
                  <DropdownMenu.RadioGroup
                    value={preferences.defaultAction.language}
                    class="w-full"
                  >
                    <For each={SUPPORTED_LANGUAGES}>
                      {(language) => (
                        <MenuItem
                          value={language}
                          selectorType="radio"
                          text={language}
                          groupValue={
                            preferences.defaultAction.language ?? 'English'
                          }
                          onClick={() =>
                            updateDefaultAction({
                              type: preferences.defaultAction.type,
                              language: language,
                            })
                          }
                        />
                      )}
                    </For>
                  </DropdownMenu.RadioGroup>
                </DropdownMenuContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          </DropdownMenuContent>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </div>
  );
}
