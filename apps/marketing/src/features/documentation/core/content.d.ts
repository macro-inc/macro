declare module 'virtual:macro-docs' {
  import type { Component } from 'solid-js';
  export interface DocPage {
    slug: string;
    href: string;
    title: string;
    description: string;
    keywords: string;
  }
  export type DocNavigation = string | { group: string; pages: DocNavigation[] };
  export const pages: DocPage[];
  export const navigation: DocNavigation[];
  export const loaders: Record<string, () => Promise<{ default: Component<{ components: object }> }>>;
}
declare module 'virtual:macro-search' {
  export const searchPages: import('./page-search').SearchPage[];
}
