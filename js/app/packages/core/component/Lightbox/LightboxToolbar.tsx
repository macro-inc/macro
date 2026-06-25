import * as stackingContext from '@core/constant/stackingContext';
import { isMobile } from '@core/mobile/isMobile';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

type LightboxToolbarProps = {
  isVisible: boolean;
  children: JSX.Element;
};

export function LightboxToolbar(props: LightboxToolbarProps) {
  return (
    <div
      class={cn(
        'absolute top-4 right-4 bg-surface backdrop-blur-sm rounded-lg border border-edge p-1 flex flex-row items-center gap-1 shadow-md transition-opacity duration-300',
        isMobile() || props.isVisible
          ? 'opacity-100'
          : 'opacity-0 pointer-events-none'
      )}
      style={{ 'z-index': stackingContext.zModal + 1 }}
    >
      {props.children}
    </div>
  );
}
