import type { ThemeV0, ThemeV1 } from '../types/themeTypes';

export function convertThemev0v1(theme: ThemeV0): ThemeV1 {
  return {
    id: theme.id,
    name: theme.name,
    version: 1,
    tokens: {
      a0: { l: theme.specification['--accent-l'    ], c: theme.specification['--accent-c'  ], h: (theme.specification['--accent-h'  ] + 30) % 360},
      a1: { l: theme.specification['--accent-l'    ], c: theme.specification['--accent-c'  ], h: (theme.specification['--accent-h'  ] + 30) % 360},
      a2: { l: theme.specification['--accent-l'    ], c: theme.specification['--accent-c'  ], h: (theme.specification['--accent-h'  ] + 30) % 360},
      a3: { l: theme.specification['--accent-l'    ], c: theme.specification['--accent-c'  ], h: (theme.specification['--accent-h'  ] + 30) % 360},
      a4: { l: theme.specification['--accent-l'    ], c: theme.specification['--accent-c'  ], h: (theme.specification['--accent-h'  ] + 30) % 360},
      b0: { l: theme.specification['--surface-l'   ], c: theme.specification['--surface-c' ], h:  theme.specification['--surface-h' ]            },
      b1: { l: theme.specification['--surface-l-1' ], c: theme.specification['--surface-c' ], h:  theme.specification['--surface-h' ]            },
      b2: { l: theme.specification['--surface-l-2' ], c: theme.specification['--surface-c' ], h:  theme.specification['--surface-h' ]            },
      b3: { l: theme.specification['--surface-l-3' ], c: theme.specification['--surface-c' ], h:  theme.specification['--surface-h' ]            },
      b4: { l: theme.specification['--surface-l-4' ], c: theme.specification['--surface-c' ], h:  theme.specification['--surface-h' ]            },
      c0: { l: theme.specification['--contrast-l'  ], c: theme.specification['--contrast-c'], h:  theme.specification['--contrast-h']            },
      c1: { l: theme.specification['--contrast-l-1'], c: theme.specification['--contrast-c'], h:  theme.specification['--contrast-h']            },
      c2: { l: theme.specification['--contrast-l-2'], c: theme.specification['--contrast-c'], h:  theme.specification['--contrast-h']            },
      c3: { l: theme.specification['--contrast-l-3'], c: theme.specification['--contrast-c'], h:  theme.specification['--contrast-h']            },
      c4: { l: theme.specification['--contrast-l-4'], c: theme.specification['--contrast-c'], h:  theme.specification['--contrast-h']            },
    },
  };
}
