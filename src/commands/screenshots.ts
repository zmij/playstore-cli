/**
 * Screenshots Commands
 *
 * Commands for managing Google Play screenshots.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { getWorktreeRoot } from '../auth.js';
import { LANGUAGE_MAP, DEVICE_TYPE_MAP, LOCALE_TO_SHORT } from '../types.js';
import type { ParsedScreenshotFilename, ScreenshotUploadMode } from '../types.js';

const IMAGE_TYPES = ['phoneScreenshots', 'sevenInchScreenshots', 'tenInchScreenshots'];

export function registerScreenshotsCommands(program: Command): void {
  const screenshotsCmd = program.command('screenshots').description('Manage screenshots');

  // Summary of all screenshots
  screenshotsCmd
    .command('summary')
    .description('Show screenshot counts for all languages and device types')
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

        // Collect counts
        const langData: Map<string, Map<string, number>> = new Map();

        for (const listing of listings) {
          const counts = new Map<string, number>();

          for (const imageType of IMAGE_TYPES) {
            const screenshots = await client.listScreenshots(listing.language, imageType);
            counts.set(imageType, screenshots.length);
          }

          langData.set(listing.language, counts);
        }

        // Print header
        const localeWidth = 10;
        const colWidth = 8;
        let header = 'Locale'.padEnd(localeWidth);
        const labels: Record<string, string> = {
          phoneScreenshots: 'Phone',
          sevenInchScreenshots: '7"',
          tenInchScreenshots: '10"',
        };

        for (const imageType of IMAGE_TYPES) {
          header += (labels[imageType] || imageType).padStart(colWidth);
        }
        console.log(chalk.bold(header));
        console.log('-'.repeat(header.length));

        // Print rows
        const sortedLocales = Array.from(langData.keys()).sort();
        for (const locale of sortedLocales) {
          const counts = langData.get(locale)!;
          const shortLang = LOCALE_TO_SHORT[locale] || locale;
          let row = shortLang.padEnd(localeWidth);

          for (const imageType of IMAGE_TYPES) {
            const count = counts.get(imageType) || 0;
            const countStr = count > 0 ? count.toString() : '-';
            const colored = count > 0 ? chalk.green(countStr) : chalk.gray(countStr);
            row += colored.padStart(colWidth + (colored.length - countStr.length));
          }
          console.log(row);
        }

        console.log('-'.repeat(header.length));
        console.log(`\nTotal languages: ${listings.length}`);

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // List screenshots for a language
  screenshotsCmd
    .command('list')
    .description('List screenshots for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;

        console.log(`Screenshots for ${locale}:\n`);

        for (const imageType of IMAGE_TYPES) {
          const screenshots = await client.listScreenshots(locale, imageType);
          console.log(`${chalk.bold(imageType)}: ${screenshots.length} screenshots`);

          for (const s of screenshots) {
            console.log(`  ${s.id}`);
          }
          console.log('');
        }

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Upload screenshots
  screenshotsCmd
    .command('upload')
    .description('Upload screenshots from a directory')
    .requiredOption('--source <directory>', 'Source directory containing screenshots')
    .option('--lang <language>', 'Upload for specific language')
    .option('--all', 'Upload for all languages found in source')
    .option('--mode <mode>', 'Upload mode: replace (delete existing), add (keep existing)', 'replace')
    .option('--dry-run', 'Show what would be uploaded without uploading')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { existsSync, readdirSync, readFileSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');

        const mode = options.mode as ScreenshotUploadMode;

        if (!['replace', 'add'].includes(mode)) {
          console.error(chalk.red('Invalid mode. Use: replace or add'));
          process.exit(1);
        }

        if (!existsSync(options.source)) {
          console.error(chalk.red(`Source directory not found: ${options.source}`));
          process.exit(1);
        }

        if (!options.all && !options.lang) {
          console.error(chalk.red('Please specify --all or --lang <language>'));
          process.exit(1);
        }

        const client = createClient(options.keyFile);

        console.log(`Upload mode: ${mode}`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        // Parse screenshot filenames
        const files = readdirSync(options.source).filter(
          (f) => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.jpeg')
        );

        const parsed = files
          .map((f) => parseScreenshotFilename(f))
          .filter((p): p is ParsedScreenshotFilename => p !== null);

        if (parsed.length === 0) {
          console.log(chalk.yellow('No valid screenshot files found.'));
          console.log(
            'Expected format: {lang}-{device}-{orientation}-{feature}-{timestamp}-{resolution}.png'
          );
          return;
        }

        // Group by language
        const byLanguage = new Map<string, ParsedScreenshotFilename[]>();
        for (const p of parsed) {
          const existing = byLanguage.get(p.language) || [];
          existing.push(p);
          byLanguage.set(p.language, existing);
        }

        // Load order configuration if exists
        const worktreeRoot = getWorktreeRoot();
        const orderPath = join(worktreeRoot, 'l10n', 'metadata', 'google', 'screenshots', 'order.yaml');
        let order: string[] = [];
        if (existsSync(orderPath)) {
          const orderContent = readFileSync(orderPath, 'utf-8');
          const orderConfig = parseYaml(orderContent) as { order: string[] };
          order = orderConfig.order || [];
          console.log(chalk.dim(`Using order from: ${orderPath}`));
        }

        // Determine which languages to process
        let languagesToProcess: string[];
        if (options.all) {
          languagesToProcess = Array.from(byLanguage.keys());
        } else {
          languagesToProcess = [options.lang];
        }

        let totalUploaded = 0;
        let totalDeleted = 0;
        let totalErrors = 0;

        for (const lang of languagesToProcess) {
          const screenshots = byLanguage.get(lang);
          if (!screenshots || screenshots.length === 0) {
            console.log(chalk.yellow(`\n${lang}: No screenshots found`));
            continue;
          }

          const locale = LANGUAGE_MAP[lang] || lang;
          console.log(chalk.bold(`\n${lang} (${locale}):`));
          console.log(`  Found ${screenshots.length} screenshots`);

          // Group by device type
          const byDevice = new Map<string, ParsedScreenshotFilename[]>();
          for (const s of screenshots) {
            const existing = byDevice.get(s.device) || [];
            existing.push(s);
            byDevice.set(s.device, existing);
          }

          // Process each device type
          for (const [device, deviceScreenshots] of byDevice) {
            const imageType = DEVICE_TYPE_MAP[device];
            if (!imageType) {
              console.log(chalk.yellow(`    ${device}: Unknown device type, skipping`));
              continue;
            }

            console.log(`    ${chalk.bold(device)} (${imageType}):`);

            // Sort by order config or feature name
            const sorted = [...deviceScreenshots].sort((a, b) => {
              const aIndex = order.indexOf(a.feature);
              const bIndex = order.indexOf(b.feature);
              if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
              if (aIndex !== -1) return -1;
              if (bIndex !== -1) return 1;
              return a.feature.localeCompare(b.feature);
            });

            if (options.dryRun) {
              for (const s of sorted) {
                console.log(`      Would upload: ${s.filename}`);
              }
              continue;
            }

            // Delete existing screenshots if replace mode
            if (mode === 'replace') {
              try {
                await client.deleteAllScreenshots(locale, imageType);
                console.log(chalk.red(`      Deleted existing screenshots`));
                totalDeleted++;
              } catch (error) {
                // May fail if no screenshots exist, that's OK
              }
            }

            // Upload new screenshots
            for (const s of sorted) {
              try {
                const filePath = join(options.source, s.filename);
                const fileContent = readFileSync(filePath);

                await client.uploadScreenshot(locale, imageType, fileContent);
                console.log(chalk.green(`      Uploaded: ${s.filename}`));
                totalUploaded++;
              } catch (error) {
                console.error(
                  chalk.red(`      Failed to upload ${s.filename}:`),
                  error instanceof Error ? error.message : error
                );
                totalErrors++;
              }
            }
          }
        }

        // Commit changes if not dry run
        if (!options.dryRun && totalUploaded > 0) {
          await client.commitEdit();
        } else {
          await client.deleteEdit();
        }

        // Summary
        console.log('\n--- Summary ---');
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes were made'));
        } else {
          if (totalUploaded > 0) console.log(chalk.green(`Uploaded: ${totalUploaded}`));
          if (totalDeleted > 0) console.log(`Deleted: ${totalDeleted} sets`);
          if (totalErrors > 0) console.log(chalk.red(`Errors: ${totalErrors}`));
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Delete screenshots
  screenshotsCmd
    .command('delete')
    .description('Delete all screenshots for a language')
    .requiredOption('--lang <language>', 'Language code (e.g., en, de)')
    .option('--device <device>', 'Delete only for specific device type')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const locale = LANGUAGE_MAP[options.lang] || options.lang;

        console.log(`Deleting screenshots for ${locale}...`);
        if (options.dryRun) {
          console.log(chalk.yellow('DRY RUN - no changes will be made\n'));
        }

        const imageTypes = options.device
          ? [DEVICE_TYPE_MAP[options.device]].filter(Boolean)
          : IMAGE_TYPES;

        let totalDeleted = 0;

        for (const imageType of imageTypes) {
          const screenshots = await client.listScreenshots(locale, imageType);

          if (screenshots.length === 0) {
            continue;
          }

          console.log(`  ${chalk.bold(imageType)}: ${screenshots.length} screenshots`);

          if (options.dryRun) {
            console.log(`    Would delete ${screenshots.length} screenshots`);
          } else {
            try {
              await client.deleteAllScreenshots(locale, imageType);
              console.log(chalk.red(`    Deleted ${screenshots.length} screenshots`));
              totalDeleted += screenshots.length;
            } catch (error) {
              console.error(
                chalk.red(`    Failed to delete:`),
                error instanceof Error ? error.message : error
              );
            }
          }
        }

        if (!options.dryRun && totalDeleted > 0) {
          await client.commitEdit();
          console.log(`\nTotal deleted: ${totalDeleted}`);
        } else {
          await client.deleteEdit();
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

/**
 * Parse a screenshot filename into its components.
 *
 * Expected format: {lang}-{device}-{orientation}-{feature}-{timestamp}-{resolution}.png
 * Example: en-android-phone-wqhd-p-blr-detail-20260122-201913-1440x2560.png
 */
function parseScreenshotFilename(filename: string): ParsedScreenshotFilename | null {
  // Remove extension
  const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');

  // Pattern for android device naming: lang-android-type-size-orientation-feature-timestamp-resolution
  // e.g., en-android-phone-wqhd-p-blr-detail-20260122-201913-1440x2560
  const androidMatch = base.match(
    /^([a-z]{2})-([a-z]+-[a-z]+-[a-z0-9]+)-([pl])-(.+)-(\d{8}-\d{6}|\d{8})-(\d+x\d+)$/i
  );

  if (androidMatch) {
    return {
      language: androidMatch[1],
      device: androidMatch[2],
      orientation: androidMatch[3].toLowerCase() as 'p' | 'l',
      feature: androidMatch[4],
      timestamp: androidMatch[5],
      resolution: androidMatch[6],
      filename,
    };
  }

  // Alternative pattern for simpler device names
  const simpleMatch = base.match(
    /^([a-z]{2})-([a-z]+-[a-z0-9]+)-([pl])-(.+)-(\d{8}-\d{6}|\d{8})-(\d+x\d+)$/i
  );

  if (simpleMatch) {
    return {
      language: simpleMatch[1],
      device: simpleMatch[2],
      orientation: simpleMatch[3].toLowerCase() as 'p' | 'l',
      feature: simpleMatch[4],
      timestamp: simpleMatch[5],
      resolution: simpleMatch[6],
      filename,
    };
  }

  return null;
}
