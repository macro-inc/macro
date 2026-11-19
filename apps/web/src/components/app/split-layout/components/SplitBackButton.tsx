import { t } from '@app/lib/i18n';
import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import CaretLeft from '@icon/system/regular/caret-left.svg';
import { Button } from '@ui';
import { useContext } from 'solid-js';
import { runSplitBack } from '../back-interceptor';
import { SplitPanelContext } from '../context';
import type { SplitContent } from '../layoutManager';
import {
  projectBackFallback,
  projectLocation,
  runProjectBack,
} from '../project-back-navigation';

export function splitBackFallback(
  content: SplitContent
): SplitContent | undefined {
  if (content.type === 'agent' || (isTouchDevice() && content.type === 'chat'))
    return { type: 'component', id: 'agents' };
  if (isTouchDevice()) return projectBackFallback(content);
}

/** Shared shell navigation and glyph; a page callback retains draft guards or a cold-link fallback. */
export function SplitBackButton(props: { onBack?: () => void } = {}) {
  const context = useContext(SplitPanelContext);
  if (!context) return null;
  const fallback = () => splitBackFallback(context.handle.content());
  const canGoBack = () =>
    Boolean(props.onBack) || context.handle.canGoBack() || Boolean(fallback());
  return (
    <Button
      variant="ghost"
      aria-label={t('splitMenu.goBack')}
      tooltip={{ content: t('splitMenu.goBack'), hotkey: TOKENS.split.go.back }}
      size="icon-sm"
      class="p-1 touch:active:bg-transparent"
      disabled={!canGoBack()}
      onClick={() =>
        runSplitBack({
          canGoBack,
          goBack: () => {
            if (props.onBack) {
              props.onBack();
              return;
            }
            const project = projectLocation(context.handle.content());
            if (isMobile() && project && project.kind !== 'list') {
              runProjectBack(context.handle);
              return;
            }
            if (!context.handle.canGoBack()) {
              const next = fallback();
              if (next) context.handle.replace({ next, mergeHistory: true });
            } else context.handle.goBack();
          },
        })
      }
    >
      <CaretLeft class="size-3.5 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}
