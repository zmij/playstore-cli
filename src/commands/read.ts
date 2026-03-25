/**
 * Read Commands
 *
 * Commands for reading app information from Google Play Console.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { createClient } from '../client.js';

export function registerReadCommands(program: Command): void {
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
