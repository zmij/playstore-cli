#!/usr/bin/env node

/**
 * Google Play Console CLI
 *
 * A command-line tool for managing Google Play Console metadata and screenshots.
 */

import { Command } from 'commander';
import { registerReadCommands } from './commands/read.js';
import { registerListingsCommands } from './commands/listings.js';
import { registerScreenshotsCommands } from './commands/screenshots.js';
import { registerTracksCommands } from './commands/tracks.js';

const program = new Command();

program
  .name('playstore')
  .description('CLI tool for managing Google Play Console metadata and screenshots')
  .version('1.0.0');

// Register command groups
registerReadCommands(program);
registerListingsCommands(program);
registerScreenshotsCommands(program);
registerTracksCommands(program);

program.parse();
