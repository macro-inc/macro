import { DecoratorRenderer } from '@core/component/LexicalMarkdown/component/core/DecoratorRenderer';
import { NodeAccessoryRenderer } from '@core/component/LexicalMarkdown/component/core/NodeAccessoryRenderer';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  codePlugin,
  createAccessoryStore,
  INSERT_CODE_PREVIEW_COMMAND,
} from '@core/component/LexicalMarkdown/plugins';
import { embeddedCodeBlock } from '@core/component/LexicalMarkdown/theme';
import { blockMetadataSignal, blockTextSignal } from '@core/signal/load';
import { getSupportedLanguageFromFileExtension } from '@lexical-core';
import { onCleanup, onMount } from 'solid-js';

export function CodeMarkdown() {
  let mountRef!: HTMLDivElement;
  const blockText = blockTextSignal.get;
  const blockMetadata = blockMetadataSignal.get;

  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown',
    namespace: 'code-markdown',
    isInteractable: () => false,
    theme: embeddedCodeBlock,
  });

  const { editor, plugins, cleanup } = lexicalWrapper;
  const [accessories, setAccessories] = createAccessoryStore();
  plugins.richText().use(codePlugin({ accessories, setAccessories }));

  onCleanup(cleanup);

  onMount(() => {
    const code = blockText();
    const fileType = blockMetadata()?.fileType;
    const language = getSupportedLanguageFromFileExtension(fileType);
    editor.setRootElement(mountRef);
    editor.setEditable(false);
    if (code) {
      editor.dispatchCommand(INSERT_CODE_PREVIEW_COMMAND, {
        language,
        code: code,
      });
    }
  });

  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div class="w-full h-full">
        <div class="w-full h-full" ref={mountRef} contentEditable={false} />
        <DecoratorRenderer editor={editor} />
        <NodeAccessoryRenderer editor={editor} store={accessories} />
      </div>
    </LexicalWrapperContext.Provider>
  );
}
