#!/usr/bin/env node
// Build docs/public/llms-full.txt from the markdown sources under docs/.
//
// One-shot ingestion file for LLM agents (https://llmstxt.org). The shorter
// curated index lives at docs/public/llms.txt and is hand-maintained — this
// script only emits the long-form concatenation.
//
// Strips VitePress frontmatter and prepends a page header per source file.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(REPO_ROOT, 'docs');
const OUT = join(DOCS, 'public', 'llms-full.txt');
const SITE = 'https://zmij.github.io/playstore-cli';

// Page order matches the VitePress sidebar in docs/.vitepress/config.ts.
const PAGES = [
  { file: 'index.md', title: 'What is playstore-cli?', slug: '/' },
  { file: 'getting-started.md', title: 'Get started', slug: '/getting-started' },
  { file: 'auth.md', title: 'Authentication', slug: '/auth' },
  { file: 'workflow.md', title: 'Workflow', slug: '/workflow' },
  { file: 'iap-schema.md', title: 'IAP schema', slug: '/iap-schema' },
  { file: 'listings-schema.md', title: 'Listings schema', slug: '/listings-schema' },
  { file: 'quirks.md', title: 'Play quirks', slug: '/quirks' },
];

function stripFrontmatter(source) {
  if (!source.startsWith('---\n')) return source;
  const end = source.indexOf('\n---\n', 4);
  if (end === -1) return source;
  return source.slice(end + 5).replace(/^\n+/, '');
}

const header = [
  '# playstore-cli — full documentation',
  '',
  'Single-file concatenation of every page on the playstore-cli docs site,',
  `for one-shot LLM ingestion. Live site: ${SITE}/`,
  '',
  'Page index:',
  ...PAGES.map((p) => `- ${p.title} — ${SITE}${p.slug === '/' ? '/' : p.slug}`),
  '',
  '---',
  '',
].join('\n');

const sections = await Promise.all(
  PAGES.map(async ({ file, title, slug }) => {
    const raw = await readFile(join(DOCS, file), 'utf8');
    const body = stripFrontmatter(raw).trimEnd();
    const url = `${SITE}${slug === '/' ? '/' : slug}`;
    return [`# ${title}`, '', `Source: ${url}`, '', body, '', '---', ''].join('\n');
  }),
);

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, header + sections.join('\n'), 'utf8');

console.log(`wrote ${OUT} (${PAGES.length} pages)`);
