import { defineConfig } from 'vitepress';

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'playstore-cli',
  description:
    'CLI + bundled MCP server for managing Google Play Console metadata, in-app products, and subscriptions from YAML files.',

  // The site deploys at https://zmij.github.io/playstore-cli/ — every
  // generated link is prefixed by `base`. Switching to a custom domain
  // means dropping this back to '/' and adding a CNAME.
  base: '/playstore-cli/',

  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', href: '/playstore-cli/favicon.svg', type: 'image/svg+xml' }],
    ['meta', { name: 'theme-color', content: '#34a853' }],
    ['meta', { property: 'og:title', content: 'playstore-cli' }],
    ['meta', { property: 'og:type', content: 'website' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Manage Android Google Play Console listings, in-app products, and subscriptions from YAML files. CLI + bundled MCP server.',
      },
    ],
  ],

  themeConfig: {
    nav: [
      { text: 'Get started', link: '/getting-started' },
      {
        text: 'Reference',
        items: [
          { text: 'IAP schema', link: '/iap-schema' },
          { text: 'Listings schema', link: '/listings-schema' },
          { text: 'Play quirks', link: '/quirks' },
        ],
      },
      { text: 'GitHub', link: 'https://github.com/zmij/playstore-cli' },
      { text: 'Lazy Sudoku', link: 'https://lazy-sudoku.online' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is playstore-cli?', link: '/' },
          { text: 'Get started', link: '/getting-started' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Authentication', link: '/auth' },
          { text: 'Workflow', link: '/workflow' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'IAP schema', link: '/iap-schema' },
          { text: 'Listings schema', link: '/listings-schema' },
          { text: 'Play quirks', link: '/quirks' },
        ],
      },
    ],

    socialLinks: [{ icon: 'github', link: 'https://github.com/zmij/playstore-cli' }],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/zmij/playstore-cli/edit/master/docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message:
        'Released under the MIT Licence. Battle-tested on <a href="https://lazy-sudoku.online">Lazy Sudoku</a>.',
      copyright: 'Copyright © 2025 Sergei Fedorov',
    },
  },
});
