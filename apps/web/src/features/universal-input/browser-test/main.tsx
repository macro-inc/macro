import { UserMention } from '@core/component/LexicalMarkdown/component/decorator/UserMention';
import { setDecorator, UserMentionNode } from '@macro-inc/lexical-core';
import { render } from 'solid-js/web';
import { UniversalInputFixture } from './fixture';
import { SelectionOfferFixture } from './selection-fixture';

setDecorator(UserMentionNode, UserMention);

const selection = new URLSearchParams(window.location.search).has('selection');

render(
  () => (selection ? <SelectionOfferFixture /> : <UniversalInputFixture />),
  document.getElementById('root')!
);
