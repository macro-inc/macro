import type { ConnectAppInfo } from '@macro-inc/lexical-core';
import type { MacroDecorators } from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type {
  JsonObject,
  JsonValue,
} from '@macro-inc/lexical-wasm-view/view/types';
import type { EditorThemeClasses } from 'lexical';
import { createMemo } from 'solid-js';
import { ConnectApp } from '../component/decorator/ConnectApp';
import { GroupMention } from '../component/decorator/GroupMention';
import { ThemeMention } from '../component/decorator/ThemeMention';
import { UnknownMention } from '../component/decorator/UnknownMention';
import { createNativeSelectionHost } from './native-selection-host';

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reuse the four application chips with their complete, narrow editor dependency. */
export function createNativeFastSelectionDecoratorViews(
  theme: EditorThemeClasses
): Pick<
  MacroDecorators,
  'group-mention' | 'unknown-mention' | 'theme-mention' | 'connect-app'
> {
  return {
    'group-mention'(props) {
      const host = createNativeSelectionHost(props);
      const groupAlias = createMemo(() => {
        const value = props.node().props().groupAlias;
        if (typeof value !== 'string') throw new Error('Invalid group alias');
        return value;
      });
      return (
        <GroupMention
          groupAlias={groupAlias()}
          key={String(props.node().key)}
          theme={theme}
          host={host}
        />
      );
    },
    'unknown-mention'(props) {
      const host = createNativeSelectionHost(props);
      const name = createMemo(() => {
        const value = props.node().props().name;
        if (typeof value !== 'string')
          throw new Error('Invalid unknown mention name');
        return value;
      });
      return (
        <UnknownMention
          name={name()}
          key={String(props.node().key)}
          theme={theme}
          host={host}
        />
      );
    },
    'theme-mention'(props) {
      const host = createNativeSelectionHost(props);
      const payload = createMemo(() => {
        const value = props.node().props();
        if (typeof value.name !== 'string' || !isObject(value.data))
          throw new Error('Invalid theme mention payload');
        return { name: value.name, data: value.data };
      });
      return (
        <ThemeMention
          name={payload().name}
          data={payload().data}
          key={String(props.node().key)}
          theme={theme}
          host={host}
        />
      );
    },
    'connect-app'(props) {
      const host = createNativeSelectionHost(props);
      const payload = createMemo<ConnectAppInfo>(() => {
        const value = props.node().props();
        if (
          typeof value.name !== 'string' ||
          typeof value.appSlug !== 'string' ||
          (value.target !== 'harness' && value.target !== 'connections')
        )
          throw new Error('Invalid connect app payload');
        return {
          name: value.name,
          appSlug: value.appSlug,
          target: value.target,
        };
      });
      return (
        <ConnectApp
          name={payload().name}
          appSlug={payload().appSlug}
          target={payload().target}
          key={String(props.node().key)}
          theme={theme}
          host={host}
        />
      );
    },
  };
}
