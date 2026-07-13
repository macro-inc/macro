import { Col, Row, View } from './core/Layout';
import { Compose, Render } from './render';
import { Card } from './widgets/Card';
import { ChannelMessage } from './widgets/ChannelMessage';
import { List } from './widgets/List';
import { Md } from './widgets/Md';
import { Stat } from './widgets/Stat';
import { Timeline } from './widgets/Timeline';

/**
 * The public dynamic-ui API: a namespace of composable components plus the two
 * renderers. Consumers either compose primitives directly (`<Widget.Stat …/>`)
 * or hand a schema node / view to `<Widget.Render>` / `<Widget.Compose>`.
 */
export const Widget = {
  Render,
  Compose,
  View,
  Row,
  Col,
  Md,
  Stat,
  Timeline,
  Card,
  ChannelMessage,
  List,
};
