/**
 * Track Commands
 *
 * Commands for listing, querying, and promoting release tracks
 * on Google Play Console.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';
import { getWorktreeRoot } from '../auth.js';
import { LANGUAGE_MAP } from '../types.js';

/**
 * Parse "What's New" sections from play-store-*.md metadata files.
 * Returns release notes keyed by Google Play locale.
 */
function loadReleaseNotesFromMetadata(): Array<{ language: string; text: string }> {
  const root = getWorktreeRoot();
  const metadataDir = join(root, 'l10n', 'metadata', 'google');
  const notes: Array<{ language: string; text: string }> = [];

  const files = readdirSync(metadataDir).filter(
    (f: string) => f.startsWith('play-store-') && f.endsWith('.md')
  );

  for (const file of files) {
    // Extract language code: play-store-en.md → en, play-store-es-ES.md → es-ES
    const match = file.match(/^play-store-(.+)\.md$/);
    if (!match) continue;

    const langCode = match[1];
    const content = readFileSync(join(metadataDir, file), 'utf-8');

    // Extract "What's New" section
    const whatsNewMatch = content.match(/## What's New\n\n([\s\S]*?)(?=\n## |$)/);
    if (!whatsNewMatch) continue;

    const whatsNew = whatsNewMatch[1].trim();
    if (!whatsNew) continue;

    // Map to Google Play locale
    const locale = LANGUAGE_MAP[langCode];
    if (locale) {
      notes.push({ language: locale, text: whatsNew });
    }
  }

  return notes;
}

export function registerTracksCommands(program: Command): void {
  const tracksCmd = program.command('tracks').description('Manage release tracks');

  // List all tracks
  tracksCmd
    .command('list')
    .description('List all release tracks')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const tracks = await client.listTracks();

        if (tracks.length === 0) {
          console.log('No tracks found.');
          return;
        }

        console.log(chalk.bold('Release Tracks:\n'));

        for (const track of tracks) {
          console.log(`${chalk.bold(track.track)}:`);

          if (track.releases.length === 0) {
            console.log('  No releases');
          } else {
            for (const release of track.releases) {
              const versionStr = release.versionCodes?.join(', ') || 'none';
              console.log(`  ${release.status}: version codes [${versionStr}]`);
              if (release.name) {
                console.log(`    Name: ${release.name}`);
              }
            }
          }
          console.log('');
        }

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show specific track
  tracksCmd
    .command('show')
    .description('Show details for a specific track')
    .requiredOption('--track <name>', 'Track name (e.g., production, beta, alpha, internal)')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const track = await client.getTrack(options.track);

        if (!track) {
          console.log(chalk.yellow(`Track not found: ${options.track}`));
          await client.deleteEdit();
          return;
        }

        console.log(chalk.bold(`Track: ${track.track}\n`));

        if (track.releases.length === 0) {
          console.log('No releases in this track.');
        } else {
          for (const release of track.releases) {
            console.log(`Release:`);
            console.log(`  Status: ${release.status}`);
            if (release.name) {
              console.log(`  Name: ${release.name}`);
            }
            if (release.versionCodes && release.versionCodes.length > 0) {
              console.log(`  Version codes: ${release.versionCodes.join(', ')}`);
            }
            if (release.releaseNotes && release.releaseNotes.length > 0) {
              console.log(`  Release notes:`);
              for (const note of release.releaseNotes) {
                console.log(`    ${note.language}: ${note.text.substring(0, 50)}...`);
              }
            }
            console.log('');
          }
        }

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Promote build between tracks
  tracksCmd
    .command('promote')
    .description('Promote a build from one track to another')
    .option('--from <track>', 'Source track (default: internal)', 'internal')
    .option('--to <track>', 'Target track (default: alpha)', 'alpha')
    .option('--notes-from-metadata', 'Load release notes from l10n/metadata/google/ instead of copying from source track')
    .option('--dry-run', 'Show what would happen without making changes')
    .option('--yes', 'Skip confirmation prompt')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);

        // Get source track
        const sourceTrack = await client.getTrack(options.from);
        if (!sourceTrack) {
          console.error(chalk.red(`Source track not found: ${options.from}`));
          await client.deleteEdit();
          process.exit(1);
        }

        // Find the latest completed release
        const completedRelease = sourceTrack.releases.find((r) => r.status === 'completed');
        if (!completedRelease) {
          console.error(chalk.red(`No completed release found on track: ${options.from}`));
          console.log('Available releases:');
          for (const r of sourceTrack.releases) {
            console.log(`  ${r.status}: version codes [${r.versionCodes?.join(', ') || 'none'}]`);
          }
          await client.deleteEdit();
          process.exit(1);
        }

        const versionCodes = completedRelease.versionCodes || [];
        if (versionCodes.length === 0) {
          console.error(chalk.red('No version codes in the completed release.'));
          await client.deleteEdit();
          process.exit(1);
        }

        // Resolve release notes
        let releaseNotes = completedRelease.releaseNotes;
        if (options.notesFromMetadata) {
          console.log(chalk.blue('Loading release notes from metadata files...'));
          releaseNotes = loadReleaseNotesFromMetadata();
          console.log(`  Found notes for ${releaseNotes.length} languages`);
        }

        // Show summary
        console.log(chalk.bold('\nTrack Promotion:'));
        console.log(`  From: ${chalk.cyan(options.from)}`);
        console.log(`  To: ${chalk.cyan(options.to)}`);
        console.log(`  Version codes: ${versionCodes.join(', ')}`);
        if (releaseNotes && releaseNotes.length > 0) {
          console.log(`  Release notes: ${releaseNotes.length} languages`);
        } else {
          console.log(`  Release notes: none`);
        }

        if (options.dryRun) {
          console.log(chalk.yellow('\n[Dry run] No changes made.'));
          await client.deleteEdit();
          return;
        }

        if (!options.yes) {
          const readline = await import('readline');
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.yellow('\nProceed? (y/N) '), resolve);
          });
          rl.close();

          if (answer.toLowerCase() !== 'y') {
            console.log('Cancelled.');
            await client.deleteEdit();
            return;
          }
        }

        // Create a new edit for the update (previous one was read-only)
        await client.deleteEdit();
        await client.startEdit();

        await client.updateTrack(options.to, [
          {
            versionCodes,
            status: 'completed',
            releaseNotes,
          },
        ]);

        await client.commitEdit();
        console.log(chalk.green(`\n✓ Build promoted from ${options.from} to ${options.to}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        try {
          const client = createClient(options.keyFile);
          await client.deleteEdit();
        } catch {
          // Ignore cleanup errors
        }
        process.exit(1);
      }
    });
}
