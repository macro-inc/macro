import type { Component } from 'solid-js';
import { UtilPlainText } from '../components/utils/UtilPlainText';
import { setPageSeo } from '../utils/utilSeo';
import './RouteLegal.css';

const content = `# Legal

Macro's terms, privacy policies, and account deletion information.

- [Terms of service](/terms)
- [Privacy policy](/privacy)
- [Data processing agreement](/dpa)
- [Partner program terms](/partners/terms)
- [Delete your account](/delete-account)
`;

export const RouteLegal: Component = () => {
  setPageSeo({
    title: 'Legal · Macro',
    description:
      "Macro's terms of service, privacy policy, data processing agreement, partner terms, and account deletion information.",
    path: '/legal',
  });
  return <UtilPlainText content={content} lists />;
};
