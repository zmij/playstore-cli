/**
 * Listings Commands
 *
 * Commands for managing Google Play store listings.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { getWorktreeRoot } from '../auth.js';
import { LANGUAGE_MAP, LOCALE_TO_SHORT } from '../types.js';
import type { ListingMetadata } from '../types.js';

export function registerListingsCommands(program: Command): void {
  const listingsCmd = program.command('listings').description('Manage store listings');

  // List all listings
  listingsCmd
    .command('list')
    .description('List all store listings')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const listings = await client.listListings();

        if (listings.length === 0) {
          console.log('No listings found.');
          await client.deleteEdit();
          return;
        }

        console.log(chalk.bold(`Store Listings (${listings.length}):\n`));

        for (const listing of listings) {
          console.log(`${chalk.bold(listing.language)}:`);
          console.log(`  Title: ${listing.title}`);
          console.log(`  Short: ${listing.shortDescription.substring(0, 60)}...`);
          console.log('');
        }

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show specific listing
  listingsCmd
    .command('show')
    .description('Show listing for a specific language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;
        const listing = await client.getListing(locale);

        if (!listing) {
          console.log(chalk.yellow(`Listing not found for: ${locale}`));
          await client.deleteEdit();
          return;
        }

        console.log(chalk.bold(`Listing: ${listing.language}\n`));
        console.log(`Title: ${listing.title}`);
        console.log(`\nShort Description (${listing.shortDescription.length}/80 chars):`);
        console.log(listing.shortDescription);
        console.log(`\nFull Description (${listing.fullDescription.length}/4000 chars):`);
        console.log(listing.fullDescription);

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Update listings from YAML
  listingsCmd
    .command('update')
    .description('Update listings from YAML metadata files')
    .option('--all', 'Update all languages')
    .option('--lang <language>', 'Update specific language')
    .option(
      '--field <field>',
      'Update specific field only (title, short_description, full_description)'
    )
    .option('--dry-run', 'Show what would be updated without making changes')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { existsSync, readFileSync, readdirSync } = await import('fs');
        const { join, basename } = await import('path');
        const { parse: parseYaml } = await import('yaml');

        if (!options.all && !options.lang) {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        const client = createClient(options.keyFile);
        const worktreeRoot = getWorktreeRoot();
        const listingsDir = join(worktreeRoot, 'l10n', 'metadata', 'google', 'listings');

        if (!existsSync(listingsDir)) {
          console.error(chalk.red(`Listings directory not found: ${listingsDir}`));
          process.exit(1);
        }

        // Get list of YAML files to process
        let files: string[];
        if (options.all) {
          files = readdirSync(listingsDir).filter((f) => f.endsWith('.yaml'));
        } else {
          const langFile = `${options.lang}.yaml`;
          if (!existsSync(join(listingsDir, langFile))) {
            console.error(chalk.red(`Listing file not found: ${langFile}`));
            process.exit(1);
          }
          files = [langFile];
        }

        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        let updated = 0;
        let errors = 0;

        for (const file of files) {
          const shortLang = basename(file, '.yaml');
          const locale = LANGUAGE_MAP[shortLang] || shortLang;
          const filePath = join(listingsDir, file);

          try {
            const content = readFileSync(filePath, 'utf-8');
            const metadata = parseYaml(content) as ListingMetadata;

            console.log(`${chalk.bold(shortLang)} (${locale}):`);

            // Build update data based on field option
            const updateData: Partial<{
              title: string;
              shortDescription: string;
              fullDescription: string;
            }> = {};

            if (!options.field || options.field === 'title') {
              if (metadata.title) {
                updateData.title = metadata.title;
                console.log(`  Title: ${metadata.title}`);
              }
            }

            if (!options.field || options.field === 'short_description') {
              if (metadata.short_description) {
                updateData.shortDescription = metadata.short_description;
                console.log(`  Short: ${metadata.short_description.substring(0, 40)}...`);
              }
            }

            if (!options.field || options.field === 'full_description') {
              if (metadata.full_description) {
                updateData.fullDescription = metadata.full_description;
                console.log(`  Full: ${metadata.full_description.substring(0, 40)}...`);
              }
            }

            if (Object.keys(updateData).length === 0) {
              console.log(chalk.yellow('  No fields to update'));
              continue;
            }

            if (!options.dryRun) {
              await client.updateListing(locale, updateData);
              console.log(chalk.green('  Updated'));
            }

            updated++;
          } catch (error) {
            console.error(
              chalk.red(`  Error: ${error instanceof Error ? error.message : error}`)
            );
            errors++;
          }
        }

        // Commit changes if not dry run
        if (!options.dryRun && updated > 0) {
          await client.commitEdit();
          console.log(chalk.green(`\nCommitted ${updated} listing update(s)`));
        } else if (options.dryRun) {
          await client.deleteEdit();
          console.log(chalk.yellow(`\nDRY RUN - would update ${updated} listing(s)`));
        } else {
          await client.deleteEdit();
        }

        if (errors > 0) {
          console.log(chalk.red(`Errors: ${errors}`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Export listings to YAML
  listingsCmd
    .command('export')
    .description('Export current listings to YAML files')
    .option('--output <directory>', 'Output directory', 'l10n/metadata/google/listings')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { existsSync, mkdirSync, writeFileSync } = await import('fs');
        const { join, isAbsolute } = await import('path');
        const { stringify: stringifyYaml } = await import('yaml');

        const client = createClient(options.keyFile);
        const worktreeRoot = getWorktreeRoot();

        // Resolve output directory
        const outputDir = isAbsolute(options.output)
          ? options.output
          : join(worktreeRoot, options.output);

        if (!existsSync(outputDir)) {
          mkdirSync(outputDir, { recursive: true });
        }

        const listings = await client.listListings();

        if (listings.length === 0) {
          console.log('No listings to export.');
          await client.deleteEdit();
          return;
        }

        console.log(`Exporting ${listings.length} listings to ${outputDir}\n`);

        for (const listing of listings) {
          const shortLang = LOCALE_TO_SHORT[listing.language] || listing.language;
          const filePath = join(outputDir, `${shortLang}.yaml`);

          const metadata: ListingMetadata = {
            whats_new: '', // Not available from listings API
            title: listing.title,
            short_description: listing.shortDescription,
            full_description: listing.fullDescription,
          };

          const yaml = stringifyYaml(metadata, {
            lineWidth: 0,
            defaultStringType: 'BLOCK_LITERAL',
          });

          writeFileSync(filePath, yaml);
          console.log(`  ${shortLang}: ${filePath}`);
        }

        await client.deleteEdit();
        console.log(chalk.green(`\nExported ${listings.length} listings`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
