import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import { useContext } from 'solid-js';
import { runSplitBack } from '../back-interceptor';
import { SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';

export function hasAgentsBackFallback(content: SplitContent) {
  return (
    content.type === 'agent' || (isTouchDevice() && content.type === 'chat')
  );
}

/** Shared shell navigation and glyph; a page callback retains draft guards or a cold-link fallback. */
export function SplitBackButton(props: { onBack?: () => void } = {}) {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  return (
    <Button
      variant="ghost"
      aria-label={t('splitMenu.goBack')}
      tooltip={{ content: t('splitMenu.goBack'), hotkey: TOKENS.split.go.back }}
      size="icon-sm"
      class="p-1 touch:active:bg-transparent"
      disabled={
        !props.onBack &&
        !context.handle.canGoBack() &&
        !hasAgentsBackFallback(context.handle.content())
      }
      onClick={() =>
        runSplitBack({
          canGoBack: () =>
            Boolean(props.onBack) ||
            context.handle.canGoBack() ||
            hasAgentsBackFallback(context.handle.content()),
          goBack: () => {
            if (props.onBack) props.onBack();
            else if (!context.handle.canGoBack())
              context.handle.replace({
                next: { type: 'component', id: 'agents' },
                mergeHistory: true,
              });
            else context.handle.goBack();
          },
        })
      }
    >
      <CaretLeft class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}
