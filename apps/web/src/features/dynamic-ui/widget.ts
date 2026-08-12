import { Col, Row, View } from './core/Layout';
import { Compose, Render } from './render';
import { ChannelMessage } from './widgets/ChannelMessage';
import { List } from './widgets/List';
import { Md } from './widgets/Md';
import { Timeline } from './widgets/Timeline';

/**
 * The public dynamic-ui API: a namespace of composable components plus the two
 * renderers. Consumers either compose primitives directly (`<Widget.Md …/>`)
 * or hand a schema node / view to `<Widget.Render>` / `<Widget.Compose>`.
 */
export const Widget = {
  Render,
  Compose,
  View,
  Row,
  Col,
  Md,
  Timeline,
  ChannelMessage,
  List,
};
