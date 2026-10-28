import type { Component, JSX } from 'solid-js';
import { Cube, IsoLine, Tile } from './IsoLineArt';

// Small isometric line-art glyphs for the footer feature nav. They share the
// same 30° projection, thin outlines, and faint fills as the home figures
// (EmailFeatureFigures / SectionHomeIntro). The cube arrangements are chosen so
// each one nods at its feature — a stack of messages, a record grid, a branch —
// while staying in the same abstract box language.

const GLYPH_VIEW_BOX = '0 0 140 100';

// Each glyph's drawn shapes sit below the geometric centre of the 140×100
// viewBox (cubes grow downward from their top face). To make the glyphs read
// as centred — especially inside the header's square icon tiles — every glyph
// passes a viewBox whose vertical window is shifted down by the offset between
// its content's bounding-box centre and the viewBox centre, so the content ends
// up centred in the rendered frame. Width stays 140 (content is already centred
// horizontally around x=70), height stays 100.
function GlyphSvg(props: {
  height: string;
  viewBox?: string;
  children: JSX.Element;
}) {
  return (
    <svg
      viewBox={props.viewBox ?? GLYPH_VIEW_BOX}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width={1.6}
      stroke-linejoin="round"
      stroke-linecap="round"
      style={{
        display: 'block',
        height: props.height,
        overflow: 'visible',
        width: 'auto',
      }}
    >
      {props.children}
    </svg>
  );
}

// Agents — an autonomous agent hovering above, and working on, the workspace.
function GlyphAgents(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 12 140 100">
      <Cube cx={70} cy={64} w={24} h={22} />
      <IsoLine
        from={{ x: 70, y: 44 }}
        to={{ x: 70, y: 52 }}
        dashed
        opacity={0.5}
      />
      <Cube cx={70} cy={30} w={9} h={9} />
    </GlyphSvg>
  );
}

// Email — a fanned stack of incoming messages.
function GlyphEmail(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 11 140 100">
      <Tile cx={62} cy={74} w={32} t={6} />
      <Tile cx={70} cy={58} w={32} t={6} />
      <Tile cx={78} cy={42} w={32} t={6} />
    </GlyphSvg>
  );
}

// Documents — a neat stack of pages.
function GlyphDocuments(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 8 140 100">
      <Tile cx={70} cy={74} w={26} t={4} />
      <Tile cx={70} cy={62} w={26} t={4} />
      <Tile cx={70} cy={50} w={26} t={4} />
      <Tile cx={70} cy={38} w={26} t={4} />
    </GlyphSvg>
  );
}

// Channels — a network of linked conversations.
function GlyphChannels(props: { height: string }) {
  const a = { x: 48, y: 50 };
  const b = { x: 94, y: 46 };
  const c = { x: 70, y: 76 };
  return (
    <GlyphSvg height={props.height} viewBox="0 17 140 100">
      <IsoLine from={a} to={b} opacity={0.45} />
      <IsoLine from={a} to={c} opacity={0.45} />
      <IsoLine from={b} to={c} opacity={0.45} />
      <Cube cx={a.x} cy={a.y} w={11} h={12} />
      <Cube cx={b.x} cy={b.y} w={11} h={12} />
      <Cube cx={c.x} cy={c.y} w={11} h={12} />
    </GlyphSvg>
  );
}

// Calls — two parties on a connected line.
function GlyphCalls(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 12 140 100">
      <IsoLine from={{ x: 59, y: 56 }} to={{ x: 81, y: 56 }} opacity={0.5} />
      <Cube cx={46} cy={54} w={13} h={15} />
      <Cube cx={94} cy={54} w={13} h={15} />
    </GlyphSvg>
  );
}

// CRM — a grid of records sitting on the database platform.
function GlyphCrm(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 24 140 100">
      <Tile cx={70} cy={80} w={44} t={5} />
      <Cube cx={70} cy={46} w={10} h={9} />
      <Cube cx={54} cy={55} w={10} h={9} />
      <Cube cx={86} cy={55} w={10} h={9} />
      <Cube cx={70} cy={64} w={10} h={9} />
    </GlyphSvg>
  );
}

// Tasks — a row of items running down a list.
function GlyphTasks(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 26 140 100">
      <Tile cx={70} cy={82} w={40} t={5} />
      <Cube cx={52} cy={50} w={9} h={9} />
      <Cube cx={70} cy={59} w={9} h={9} />
      <Cube cx={88} cy={68} w={9} h={9} />
    </GlyphSvg>
  );
}

// Pull Requests — a branch forking off the main line.
function GlyphPullRequests(props: { height: string }) {
  return (
    <GlyphSvg height={props.height} viewBox="0 9 140 100">
      <IsoLine from={{ x: 52, y: 74 }} to={{ x: 52, y: 42 }} opacity={0.55} />
      <IsoLine from={{ x: 52, y: 58 }} to={{ x: 88, y: 50 }} opacity={0.55} />
      <IsoLine from={{ x: 88, y: 50 }} to={{ x: 88, y: 38 }} opacity={0.55} />
      <Cube cx={52} cy={76} w={8} h={9} />
      <Cube cx={52} cy={40} w={8} h={9} />
      <Cube cx={88} cy={32} w={8} h={9} />
    </GlyphSvg>
  );
}

export const featureNavGlyphs: Record<string, Component<{ height: string }>> = {
  '/agents': GlyphAgents,
  '/email': GlyphEmail,
  '/documents': GlyphDocuments,
  '/channels': GlyphChannels,
  '/calls': GlyphCalls,
  '/crm': GlyphCrm,
  '/tasks': GlyphTasks,
  '/github': GlyphPullRequests,
};
