import Trash from '@icon/system/regular/x.svg';
import type { HorizontalRuleDecoratorProps } from '@macro-inc/lexical-core';
import { debounce } from '@solid-primitives/scheduled';
import { Button } from '@ui';
import { createSignal } from 'solid-js';
import type { HorizontalRuleHost } from '../../context/DecoratorHostContext';
import { useDecoratorHost } from '../../decorator-host/use-decorator-host';

export function HorizontalRule(
  props: HorizontalRuleDecoratorProps & { host?: HorizontalRuleHost }
) {
  const host = props.host ?? useDecoratorHost();
  const [ruleHover, setRuleHover] = createSignal(false);
  const isSelectedAsNode = () => host.isSelected(props.key);

  const clickRuleHandler = () => host.horizontalRule.select(props.key);
  const deleteRule = () => host.horizontalRule.remove(props.key);

  const debouncedSetHover = debounce((state: boolean) => {
    setRuleHover(state);
  }, 300);

  return (
    <div
      class="relative my-2 w-full h-10 flex items-center"
      onClick={(e: MouseEvent) => {
        e.preventDefault();
        clickRuleHandler();
      }}
      onMouseEnter={() => {
        debouncedSetHover(true);
      }}
      onMouseLeave={() => {
        debouncedSetHover.clear();
        setRuleHover(false);
      }}
    >
      <div
        class="w-full h-px bg-edge rounded-full"
        classList={{
          'outline-edge outline-4': isSelectedAsNode() || ruleHover(),
        }}
      />

      {(isSelectedAsNode() || ruleHover()) && (
        <div class="absolute h-full top-0 right-2 flex flex-row gap-1 items-center">
          {host.isEditable() && (
            <Button
              variant="ghost"
              class="size-8 p-0 border-0 bg-transparent hover:bg-hover"
              tooltip="Remove"
              on:mousedown={(e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                deleteRule();
              }}
            >
              <Trash class="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
