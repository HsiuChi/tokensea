/**
 * Browser opener — cross-platform, safe URL opening.
 *
 * Uses execFile + argv array to prevent shell injection.
 */

import { execFile } from 'node:child_process';
import { platform } from 'node:process';

export function openBrowser(url: string): void {
  const allowedProtocols = ['http:', 'https:'];

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    throw new Error(`Unsupported protocol: ${parsed.protocol}`);
  }

  const cmd = platform === 'darwin' ? 'open'
    : platform === 'win32' ? 'cmd'
    : 'xdg-open';

  const args = platform === 'win32' ? ['/c', 'start', '""', url]
    : [url];

  execFile(cmd, args, (err) => {
    if (err) {
      console.error(`[codex-dario] Failed to open browser: ${err.message}`);
    }
  });
}
