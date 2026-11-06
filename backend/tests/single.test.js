// Runs in its own process: one-business mode, where the site serves a single business at "/".
process.env.DB_FILE = ':memory:';
process.env.SINGLE_BUSINESS = 'only-parlour';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const tenant = require('../src/tenant');
const app = require('../src/app');

let server, base;
test.before(
  () =>
    new Promise((resolve) => {
      tenant.createBusiness({ name: 'Only Parlour', slug: 'only-parlour', type: 'beauty', ownerName: 'O', phone: '1', password: 'secret1' });
      tenant.createBusiness({ name: 'Other One', slug: 'other-one', type: 'clinic', ownerName: 'P', phone: '2', password: 'secret1' });
      server = app.listen(0, () => {
        base = 'http://localhost:' + server.address().port;
        resolve();
      });
    })
);
test.after(() => server.close());

test('single-business mode serves one business and switches the platform off', async () => {
  // its own API works
  assert.equal((await fetch(base + '/api/b/only-parlour/settings')).status, 200);
  assert.equal((await fetch(base + '/api/b/only-parlour/services')).status, 200);
  // every other business and the platform parts answer 404
  assert.equal((await fetch(base + '/api/b/other-one/settings')).status, 404);
  assert.equal((await fetch(base + '/api/directory')).status, 404);
  assert.equal((await fetch(base + '/api/types')).status, 404);
  assert.equal((await fetch(base + '/api/slug-check?slug=abc')).status, 404);
  const signup = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(signup.status, 404);
  assert.equal((await fetch(base + '/api/platform/businesses')).status, 404);

  // the root page is that business, with the single-business marker and its own manifest
  if (fs.existsSync(path.join(__dirname, '..', '..', 'frontend', 'dist', 'index.html'))) {
    const html = await (await fetch(base + '/')).text();
    assert.match(html, /window\.__SINGLE__="only-parlour"/);
    assert.match(html, /<title>Only Parlour: Book an appointment<\/title>/);
    assert.match(html, /href="\/manifest\.webmanifest"/);
    const man = await (await fetch(base + '/manifest.webmanifest')).json();
    assert.equal(man.start_url, '/');
    assert.equal(man.scope, '/');
    assert.match(man.name, /Only Parlour/);
    // deep links fall back to the same page
    assert.match(await (await fetch(base + '/anything/here')).text(), /__SINGLE__/);
  }
});
