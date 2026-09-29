import { useNavigate } from '@solidjs/router';
import { type Component, onMount } from 'solid-js';
import { RouteHome } from './RouteHome';

export const RouteStartupsRedirect: Component = () => {
  const navigate = useNavigate();

  onMount(() => {
    navigate('/#startup-credits', { replace: true });
  });

  return <RouteHome />;
};
