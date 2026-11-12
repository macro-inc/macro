import type { JSX } from 'solid-js';
import { HomepageMobileOpenSource } from './HomepageMobileOpenSource';
import './homepage-open-source.css';

/** Share the original open-source and connected sidebar story on every screen. */
export function HomepageOpenSource(props: { children: JSX.Element }) {
  return <HomepageMobileOpenSource>{props.children}</HomepageMobileOpenSource>;
}
