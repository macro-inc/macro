import type { Component } from 'solid-js';
import { SectionHomeSimple } from '../components/sections/SectionHomeSimple';
import { setPageSeo } from '../utils/utilSeo';

export const RouteHome: Component = () => {
  setPageSeo({
    title: 'Macro — The ultimate workspace',
    description:
      'Macro replaces 11+ apps with a single system for the whole company. Email, team chat, docs, tasks, calendar, CRM and agents — tied together with team-level memory.',
    path: '/',
  });

  return <SectionHomeSimple />;
};
