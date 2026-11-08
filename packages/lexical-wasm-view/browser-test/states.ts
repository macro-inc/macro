export const richState = {
  root: {
    type: 'root',
    version: 1,
    children: [
      {
        type: 'heading',
        version: 1,
        tag: 'h2',
        children: [
          {
            type: 'text',
            version: 1,
            text: 'Heading',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
      {
        type: 'quote',
        version: 1,
        children: [
          {
            type: 'text',
            version: 1,
            text: 'Quote',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
      {
        type: 'list',
        version: 1,
        listType: 'bullet',
        tag: 'ul',
        start: 1,
        children: [
          {
            type: 'listitem',
            version: 1,
            value: 1,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'One',
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ],
          },
          {
            type: 'listitem',
            version: 1,
            value: 2,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'Two',
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ],
          },
        ],
      },
      {
        type: 'table',
        version: 1,
        colWidths: [120, 180],
        children: [
          {
            type: 'tablerow',
            version: 1,
            height: 40,
            children: [
              {
                type: 'tablecell',
                version: 1,
                headerState: 0,
                colSpan: 1,
                rowSpan: 1,
                backgroundColor: null,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [
                      {
                        type: 'text',
                        version: 1,
                        text: 'A',
                        format: 0,
                        detail: 0,
                        mode: 'normal',
                        style: '',
                      },
                    ],
                  },
                ],
              },
              {
                type: 'tablecell',
                version: 1,
                headerState: 1,
                colSpan: 1,
                rowSpan: 1,
                backgroundColor: null,
                children: [
                  {
                    type: 'paragraph',
                    version: 1,
                    children: [
                      {
                        type: 'text',
                        version: 1,
                        text: 'B',
                        format: 0,
                        detail: 0,
                        mode: 'normal',
                        style: '',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'code',
        version: 1,
        language: 'javascript',
        children: [
          {
            type: 'code-highlight',
            version: 1,
            text: 'const',
            highlightType: 'keyword',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
          {
            type: 'text',
            version: 1,
            text: ' n = 1;',
            format: 0,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
      {
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'link',
            version: 1,
            url: 'https://example.com',
            target: null,
            rel: null,
            title: null,
            children: [
              {
                type: 'text',
                version: 1,
                text: 'Link',
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ],
          },
          {
            type: 'mark',
            version: 1,
            ids: ['fixture-mark'],
            children: [
              {
                type: 'text',
                version: 1,
                text: 'Marked',
                format: 0,
                detail: 0,
                mode: 'normal',
                style: '',
              },
            ],
          },
          {
            type: 'text',
            version: 1,
            text: 'Bold',
            format: 1,
            detail: 0,
            mode: 'normal',
            style: '',
          },
        ],
      },
    ],
  },
};
