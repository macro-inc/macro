import { BetaBadge } from '@core/component/BetaBadge';

export const BetaTooltip = (props: { text: string }) => {
  return (
    <div class="border rounded border-edge p-2.5 w-44 text-xs items-center text-left bg-panel shadow-lg z-[9999]">
      <div class="absolute top-[-12px] left-[-12px] bg-panel">
        <BetaBadge />
      </div>
      <div class="py-1">{props.text}</div>
    </div>
  );
};
