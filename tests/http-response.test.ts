import { expect, test } from 'bun:test';

import { readJsonResponse } from '../src/lib/http/response';

test('returns null for an empty response body', async () => {
  expect(await readJsonResponse(new Response(''))).toBeNull();
});

test('returns null for a malformed JSON response body', async () => {
  expect(await readJsonResponse(new Response('{'))).toBeNull();
});

test('parses a JSON response body', async () => {
  expect(await readJsonResponse(new Response('{"ok":true}'))).toEqual({ ok: true });
});
