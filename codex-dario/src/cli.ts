/**
 * codex-dario — CLI entry point.
 *
 * Usage:
 *   codex-dario login       — Authenticate with OpenAI/Codex
 *   codex-dario login --device — Device code flow (headless)
 *   codex-dario status      — Check token health
 *   codex-dario proxy       — Start the API proxy (default: port 3457)
 *   codex-dario refresh     — Force token refresh
 *   codex-dario doctor      — Run health checks
 */

import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { startAutoOAuthFlow, startDeviceCodeFlow, getStatus, refreshTokens, loadCredentials } from './oauth.js';
import { startProxy } from './proxy.js';
import { runChecks, formatChecks, exitCodeFor } from './doctor.js';
import { listAccountAliases, loadAllAccounts, saveAccount, removeAccount } from './accounts.js';

const args = process.argv.slice(2);
const command = args[0] || 'proxy';

async function main() {
  switch (command) {
    case 'login': {
      const useDeviceCode = args.includes('--device') || args.includes('--headless');
      try {
        if (useDeviceCode) {
          console.log('Starting device code authentication...');
          const tokens = await startDeviceCodeFlow();
          console.log(`Authenticated! Token expires at ${new Date(tokens.expiresAt).toISOString()}`);
        } else {
          console.log('Starting browser authentication...');
          const tokens = await startAutoOAuthFlow();
          console.log(`Authenticated! Token expires at ${new Date(tokens.expiresAt).toISOString()}`);
        }
      } catch (err) {
        console.error(`Login failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      break;
    }

    case 'status': {
      const s = await getStatus();
      if (!s.authenticated) {
        console.log(`Not authenticated (${s.status})`);
        if (s.invalidated) {
          console.log('Account has been invalidated. Run `codex-dario login` to re-authenticate.');
        }
        process.exit(1);
      }
      console.log(`OAuth: ${s.status} (expires in ${s.expiresIn})`);
      if (s.invalidated) {
        console.log('WARNING: Account has been invalidated.');
      }

      // Show account pool status
      const aliases = await listAccountAliases();
      if (aliases.length > 0) {
        console.log(`Accounts: ${aliases.join(', ')}`);
      }
      break;
    }

    case 'proxy': {
      const portArg = args.findIndex(a => a === '--port' || a === '-p');
      const port = portArg >= 0 && args[portArg + 1] ? parseInt(args[portArg + 1]!, 10) : undefined;
      const hostArg = args.findIndex(a => a === '--host' || a === '-h');
      const host = hostArg >= 0 && args[hostArg + 1] ? args[hostArg + 1] : undefined;
      const verbose = args.includes('--verbose') || args.includes('-v');
      const passthrough = args.includes('--passthrough');

      try {
        await startProxy({
          port,
          host,
          verbose,
          passthrough,
          drainOnClose: args.includes('--drain-on-close'),
        });
      } catch (err) {
        console.error(`Proxy failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      break;
    }

    case 'refresh': {
      try {
        console.log('Refreshing token...');
        const tokens = await refreshTokens();
        console.log(`Token refreshed! Expires at ${new Date(tokens.expiresAt).toISOString()}`);
      } catch (err) {
        console.error(`Refresh failed: ${err instanceof Error ? err.message : err}`);
        process.exit(1);
      }
      break;
    }

    case 'doctor': {
      const checks = await runChecks();
      console.log(formatChecks(checks));
      process.exit(exitCodeFor(checks));
    }

    case 'accounts': {
      const subCommand = args[1];
      if (subCommand === 'add') {
        const alias = args[2] || 'default';
        console.log(`Adding account "${alias}" via browser OAuth...`);
        try {
          const tokens = await startAutoOAuthFlow(alias);
          console.log(`Account "${alias}" added successfully.`);
        } catch (err) {
          console.error(`Failed to add account: ${err instanceof Error ? err.message : err}`);
          process.exit(1);
        }
      } else if (subCommand === 'remove') {
        const alias = args[2];
        if (!alias) {
          console.error('Usage: codex-dario accounts remove <alias>');
          process.exit(1);
        }
        const removed = await removeAccount(alias);
        if (removed) {
          console.log(`Account "${alias}" removed.`);
        } else {
          console.error(`Account "${alias}" not found.`);
          process.exit(1);
        }
      } else {
        const aliases = await listAccountAliases();
        if (aliases.length === 0) {
          console.log('No accounts configured. Run `codex-dario login` or `codex-dario accounts add <alias>`.');
        } else {
          console.log('Accounts:');
          for (const alias of aliases) {
            console.log(`  - ${alias}`);
          }
        }
      }
      break;
    }

    case 'logout': {
      const credPath = join(homedir(), '.codex-dario', 'credentials.json');
      try {
        await unlink(credPath);
        console.log('Logged out successfully.');
      } catch {
        console.log('No credentials to remove.');
      }
      break;
    }

    default:
      console.log('codex-dario — Wire-fidelity proxy for OpenAI Codex subscriptions');
      console.log('');
      console.log('Usage:');
      console.log('  codex-dario login [--device]   Authenticate with OpenAI/Codex');
      console.log('  codex-dario status             Check token health');
      console.log('  codex-dario proxy              Start the API proxy');
      console.log('  codex-dario refresh            Force token refresh');
      console.log('  codex-dario doctor             Run health checks');
      console.log('  codex-dario accounts           Manage account pool');
      console.log('  codex-dario logout             Remove saved credentials');
  }
}

main().catch(err => {
  console.error(`Fatal: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
