import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import nodemailer from 'nodemailer';

test('updated Fastify/static serves logo and preserves protected API routes', async () => {
  const app = Fastify();
  try {
    app.get('/api/private', async (_, reply) => reply.code(401).send({ error: 'unauthorized' }));
    await app.register(fastifyStatic, { root: fileURLToPath(new URL('../web/public', import.meta.url)) });
    const icon = await app.inject('/shared/logo-mark-dark.png');
    assert.equal(icon.statusCode, 200);
    assert.match(icon.headers['content-type'], /image\/png/);
    assert.equal(icon.rawPayload.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal((await app.inject('/api/private')).statusCode, 401);
    for (const path of ['/../package.json', '/%2e%2e/package.json', '/shared/%2e%2e/%2e%2e/package.json']) {
      const response = await app.inject(path);
      assert.notEqual(response.statusCode, 200);
      assert.ok(!response.body.includes('tokensea-web'));
    }
  } finally { await app.close(); }
});

test('updated Nodemailer renders verification mail without any network delivery', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true });
  try {
    const result = await transport.sendMail({
      from: 'TokenSea <noreply@example.com>', to: 'fixture@example.com',
      subject: 'TokenSea 验证码', text: '您的验证码：123456', html: '<p>您的验证码：<b>123456</b></p>',
    });
    const message = result.message.toString();
    assert.match(message, /multipart\/alternative/);
    const bodies = [...message.matchAll(/Content-Transfer-Encoding: base64\n\n([A-Za-z0-9+/=\n]+)\n----/g)]
      .map((match) => Buffer.from(match[1].replace(/\n/g, ''), 'base64').toString('utf8'));
    assert.ok(bodies.includes('您的验证码：123456'));
    assert.ok(bodies.includes('<p>您的验证码：<b>123456</b></p>'));
    assert.match(message, /noreply@example.com/);
  } finally { transport.close(); }
});
