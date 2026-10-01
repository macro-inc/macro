import type { Component } from 'solid-js';
import { SectionHomeSimple } from '../components/sections/SectionHomeSimple';
import { setPageSeo } from '../utils/utilSeo';

export const RouteHome: Component = () => {
  setPageSeo({
    title: 'Macro — The ultimate workspace',
    description:
      'Email, messages, tasks, and agents in one inbox. CRDT documents with live agent edits, workspace search and memory, and a CRM built from your email.',
    path: '/',
  });

  return <SectionHomeSimple />;
};
