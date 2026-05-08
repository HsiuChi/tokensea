#!/usr/bin/env node
/**
 * Capture and bake — runs the Codex CLI against a MITM endpoint,
 * captures its wire shape, and saves it as the bundled template.
 *
 * Usage:
 *   node scripts/capture-and-bake.mjs [--output src/codex-template-data.json]
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = join(__dirname, '..', 'src', 'codex-template-data.json');

const outputPath = process.argv.find(a => a === '--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : DEFAULT_OUTPUT;

async function findCodexBinary() {
  const { execSync } = await import('node:child_process');
  try {
    const result = execSync('which codex 2>/dev/null', { timeout: 3000, encoding: 'utf-8' }).trim();
    if (result && existsSync(result)) return result;
  } catch {}
  return null;
}

async function capture() {
  const binary = await findCodexBinary();
  if (!binary) {
    console.error('Codex binary not found on PATH. Install Codex CLI first.');
    process.exit(1);
  }

  console.log(`Using Codex binary: ${binary}`);

  return new Promise((resolve, reject) => {
    let captured = false;

    const server = createServer(async (req, res) => {
      if (captured) {
        res.writeHead(200);
        res.end('{"id":"capture","status":"ok"}');
        return;
      }
      captured = true;

      // Read the request body
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf-8');

      // Extract template data
      const headerOrder = [];
      const headerValues = {};
      if (req.rawHeaders) {
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const name = req.rawHeaders[i];
          const value = req.rawHeaders[i + 1];
          headerOrder.push(name);
          headerValues[name.toLowerCase()] = value;
        }
      }

      let bodyFieldOrder = [];
      let systemPrompt = '';
      let tools = [];

      try {
        const parsed = JSON.parse(body);
        bodyFieldOrder = Object.keys(parsed);
        if (typeof parsed.instructions === 'string') systemPrompt = parsed.instructions;
        if (Array.isArray(parsed.tools)) tools = parsed.tools;
      } catch {}

      const ua = headerValues['user-agent'] || '';
      const versionMatch = ua.match(/codex_cli_rs\/([\d.]+)/);

      const template = {
        _version: versionMatch?.[1] || '0.1.0',
        _source: 'bundled',
        _captured: new Date().toISOString(),
        _schemaVersion: 2,
        header_order: headerOrder,
        header_values: headerValues,
        body_field_order: bodyFieldOrder,
        anthropic_beta: '',
        system_prompt: systemPrompt,
        tools,
        agent_identity: headerValues['originator'] || ua || '',
      };

      // Save
      const dir = dirname(outputPath);
      mkdirSync(dir, { recursive: true });
      writeFileSync(outputPath, JSON.stringify(template, null, 2));
      console.log(`Template saved to ${outputPath}`);
      console.log(`  Version: ${template._version}`);
      console.log(`  Headers: ${headerOrder.length}`);
      console.log(`  Body fields: ${bodyFieldOrder.join(', ')}`);
      console.log(`  Tools: ${tools.length}`);
      console.log(`  System prompt: ${systemPrompt.length} chars`);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'capture', status: 'completed' }));

      child.kill();
      server.close();
      resolve(template);
    });

    let child;
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = addr.port;

      console.log(`MITM listening on port ${port}`);

      const env = {
        ...process.env,
        CODEX_OSS_BASE_URL: `http://127.0.0.1:${port}`,
      };

      child = spawn(binary, ['--version'], { env, stdio: 'pipe' });

      child.on('error', (err) => {
        console.error(`Failed to spawn Codex: ${err.message}`);
        server.close();
        reject(err);
      });

      child.on('exit', () => {
        if (!captured) {
          console.error('Codex exited without sending a request');
          server.close();
          reject(new Error('No request captured'));
        }
      });

      setTimeout(() => {
        if (!captured) {
          child?.kill();
          server.close();
          reject(new Error('Capture timed out'));
        }
      }, 15000);
    });
  });
}

capture().catch(err => {
  console.error(`Capture failed: ${err.message}`);
  process.exit(1);
});
