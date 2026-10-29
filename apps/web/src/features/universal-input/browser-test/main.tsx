import { UserMention } from '@core/component/LexicalMarkdown/component/decorator/UserMention';
import { setDecorator, UserMentionNode } from '@macro-inc/lexical-core';
import { render } from 'solid-js/web';
import { UniversalInputFixture } from './fixture';

setDecorator(UserMentionNode, UserMention);

render(() => <UniversalInputFixture />, document.getElementById('root')!);
