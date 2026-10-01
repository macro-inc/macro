import type { Component } from 'solid-js';
import { SceneGlobe } from '../components/scenes/SceneGlobe';

export const RouteTest: Component = () => {
  return (
    <div
      style={{
        'place-items': 'center',
        display: 'grid',
        height: '100vh',
        width: '100%',
      }}
    >
      <SceneGlobe />
    </div>
  );
};
