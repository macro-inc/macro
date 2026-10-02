import { type Component, onMount } from 'solid-js';

export const RouteStartupsRedirect: Component = () => {
  onMount(() => {
    window.location.replace('/');
  });

  return null;
};
