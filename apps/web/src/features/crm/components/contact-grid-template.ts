/** People columns, shared by the rows and header so their tracks line up. */
export function contactGridTemplate(hideIndicator: boolean) {
  return {
    'grid-template-columns': [
      ...(hideIndicator ? [] : ['1rem']),
      'minmax(0, 100%)',
      'var(--contact-col-company, 12rem)',
      'var(--contact-col-timestamp, 7rem)',
    ].join(' '),
    'grid-template-areas': `"${[
      ...(hideIndicator ? [] : ['indicator']),
      'content',
      'company',
      'timestamp',
    ].join(' ')}"`,
  };
}
