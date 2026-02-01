/**
 * Read Commands
 *
 * Commands for reading app information from Google Play Console.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';

export function registerReadCommands(program: Command): void {
  // Tracks command group
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

  // App info command
  program
    .command('info')
    .description('Show app information')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);
        const details = await client.getAppDetails();

        console.log(chalk.bold('App Details:\n'));
        console.log(`Default Language: ${details.defaultLanguage || 'not set'}`);
        console.log(`Contact Email: ${details.contactEmail || 'not set'}`);
        console.log(`Contact Phone: ${details.contactPhone || 'not set'}`);
        console.log(`Contact Website: ${details.contactWebsite || 'not set'}`);

        await client.deleteEdit();
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}
