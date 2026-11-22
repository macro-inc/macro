import type { EditorThemeClasses } from 'lexical';
import type { ContactMentionHost } from './contact-host';
import type { NativeDecoratorContext } from './native-adapter';
import { createNativeEnterDecoratorContext } from './native-enter-host';

/** Published UI selection and the actual native Normal-priority Enter slot. */
export function createNativeContactContext(
  theme: EditorThemeClasses
): NativeDecoratorContext<ContactMentionHost> & { dispose(): void } {
  return createNativeEnterDecoratorContext(theme);
}
