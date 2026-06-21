#!/usr/bin/env node

/**
 * Google Play Console MCP server.
 *
 * Bundled with the playstore-cli package — same code paths as the
 * CLI, exposed over the Model Context Protocol so an agent can
 * read/list/update Play Console state without shelling out.
 *
 * Install + register:
 *
 *   npm install -g playstore-cli
 *   claude mcp add playstore playstore-mcp
 *
 * Or from a local checkout:
 *
 *   playstore-cli/build/mcp/server.js
 *
 * Auth + paths come from the same `playstore-config.yaml` and
 * `playstore-cli.config.yaml` the CLI reads. See README for setup.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { createClient } from '../client.js';

const server = new Server(
  {
    name: 'playstore-cli',
    version: '1.0.0',
  },
  {
    capabilities: { tools: {} },
  },
);

// ============================================================================
// Tool definitions
// ============================================================================
//
// Tool names match the existing in-tree sudoku-mcp wrappers so a project
// migrating to this standalone server doesn't have to rename anything.

const TOOLS = [
  {
    name: 'playstore_get_app_info',
    description:
      'Get basic app information from Play Console — package name, default language, primary contact info.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_list_tracks',
    description:
      'List all release tracks (production, beta, alpha, internal). Returns track names with their releases, version codes, and status.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_list_listings',
    description:
      'List all store listings. Returns language codes with title, short description, full description, video URL.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_show_listing',
    description: 'Show one store listing by language.',
    inputSchema: {
      type: 'object',
      properties: {
        language: { type: 'string', description: "BCP-47 language code (e.g. 'en-GB', 'de-DE')." },
      },
      required: ['language'],
    },
  },
  {
    name: 'playstore_screenshot_summary',
    description:
      'Per-language × per-device screenshot counts. Returns a matrix for phone / sevenInch / tenInch tablet screenshots per language.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_list_iap',
    description:
      'List every one-time product (managed product) via monetization.onetimeproducts. Returns productId, listing count, purchase-option count.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_list_subscriptions',
    description:
      'List every subscription via monetization.subscriptions. Returns productId, listing count, base-plan count.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'playstore_show_iap',
    description: 'Show full state for a single product — one-time or subscription, auto-detected.',
    inputSchema: {
      type: 'object',
      properties: {
        productId: { type: 'string', description: 'Product ID (e.g. "premium_lifetime", "premium_monthly").' },
      },
      required: ['productId'],
    },
  },
] as const;

// ============================================================================
// Handlers
// ============================================================================

function ok(data: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  // playstore-cli's createClient takes an optional --key-file override;
  // the MCP doesn't expose that knob — single client per server.
  const client = createClient();

  switch (name) {
    case 'playstore_get_app_info': {
      const details = await client.getAppDetails();
      return ok(details);
    }

    case 'playstore_list_tracks': {
      const tracks = await client.listTracks();
      // Always clean up the implicit edit started by listTracks().
      await client.deleteEdit();
      return ok({ tracks });
    }

    case 'playstore_list_listings': {
      const listings = await client.listListings();
      await client.deleteEdit();
      return ok({ listings });
    }

    case 'playstore_show_listing': {
      const language = (args as any).language as string;
      const listing = await client.getListing(language);
      await client.deleteEdit();
      if (!listing) {
        throw new Error(`No listing for language ${language}.`);
      }
      return ok(listing);
    }

    case 'playstore_screenshot_summary': {
      // Listings give us the language inventory; per-language we sum
      // counts for the three device tiers Play surfaces.
      const listings = await client.listListings();
      const matrix = await Promise.all(
        listings.map(async (l) => {
          const [phone, sevenInch, tenInch] = await Promise.all([
            client.listScreenshots(l.language, 'phoneScreenshots'),
            client.listScreenshots(l.language, 'sevenInchScreenshots'),
            client.listScreenshots(l.language, 'tenInchScreenshots'),
          ]);
          return {
            language: l.language,
            phone: phone.length,
            sevenInch: sevenInch.length,
            tenInch: tenInch.length,
          };
        }),
      );
      await client.deleteEdit();
      return ok({ matrix });
    }

    case 'playstore_list_iap': {
      // No edit session needed — monetization.onetimeproducts is direct.
      const products = await client.listOneTimeProducts();
      return ok({
        products: products.map((p) => ({
          productId: p.productId,
          listingCount: (p.listings ?? []).length,
          purchaseOptionCount: (p.purchaseOptions ?? []).length,
        })),
      });
    }

    case 'playstore_list_subscriptions': {
      const subs = await client.listSubscriptions();
      return ok({
        subscriptions: subs.map((s) => ({
          productId: s.productId,
          listingCount: (s.listings ?? []).length,
          basePlanCount: (s.basePlans ?? []).length,
        })),
      });
    }

    case 'playstore_show_iap': {
      const productId = (args as any).productId as string;
      // Auto-detect: try one-time first, then subscription.
      const oneTime = await client.getOneTimeProduct(productId);
      if (oneTime) {
        const offers = await client.listOneTimeProductOffers(productId, '-');
        return ok({ kind: 'one_time_product', product: oneTime, offers });
      }
      const sub = await client.getSubscription(productId);
      if (sub) {
        const offers = await client.listSubscriptionOffers(productId, '-');
        return ok({ kind: 'subscription', subscription: sub, offers });
      }
      throw new Error(`Product not found on Play: ${productId}`);
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

// ============================================================================
// Bootstrap
// ============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr-only — stdout is the MCP transport.
  process.stderr.write('playstore-cli MCP server running on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`playstore-mcp fatal: ${err instanceof Error ? err.message : err}\n`);
  process.exit(1);
});
