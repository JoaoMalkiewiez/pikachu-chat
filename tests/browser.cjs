const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fixture } = require('./helpers.cjs');
const fs = require('node:fs');
const managedUdpBlocked = fs.existsSync('/etc/chromium/policies/managed/misc.json') && JSON.parse(fs.readFileSync('/etc/chromium/policies/managed/misc.json', 'utf8')).WebRtcIPHandling === 'disable_non_proxied_udp';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
(async () => {
  const f = await fixture(); let browser;
  try {
    await f.account('Alice'); await f.account('Bob'); await f.account('Eve');
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-features=WebRtcHideLocalIpsWithMdns', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
    const errors = [], dialogs = [];
    async function pageFor(user) {
      const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 1280, height: 900 } });
      // Only Storage transport is simulated. Browser DOM, HTTP, SQL, WS and peer connections run normally.
      await context.route('**/api/{media,avatars}/**', async route => {
        const response = await route.fetch({ maxRedirects: 0 });
        if (response.status() !== 302) return route.fulfill({ response });
        const location = new URL(response.headers().location);
        const key = decodeURIComponent(location.pathname.split('/chat-media/')[1]);
        const object = f.objects.get(key);
        await route.fulfill({ status: 200, contentType: object.type, body: object.data });
      });
      await context.addInitScript(() => {
        const NativePeer=window.RTCPeerConnection;
        window.RTCPeerConnection=class extends NativePeer{constructor(options){super({...options,iceServers:[]})}};
        window.captureCalls = 0;
        navigator.mediaDevices.getDisplayMedia = async () => {
          window.captureCalls++;
          const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffd500'; ctx.fillRect(0, 0, 320, 180);
          const stream = canvas.captureStream(5);
          window.testCanvasTimer = setInterval(() => { ctx.fillRect(0, 0, 320, 180); }, 200);
          window.testScreenStream = stream;
          return stream;
        };
      });
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
      await page.goto(f.config.origin);
      await page.locator('#loginUser').fill(user); await page.locator('#loginPass').fill('test-password-12345'); await page.locator('#loginButton').click();
      await page.locator('#chatApp').waitFor({ state: 'visible' });
      assert.equal(await page.evaluate(() => window.captureCalls), 0);
      assert.equal(await page.evaluate(() => document.cookie.includes('pikachu_session')), false);
      return page;
    }
    const alice = await pageFor('Alice'), bob = await pageFor('Bob'), eve = await pageFor('Eve');
    await alice.locator('[data-user="Bob"]').click(); await bob.locator('[data-user="Alice"]').click();
    await alice.locator('#messageInput').fill('<img src=x onerror=alert(1)>'); await alice.locator('#sendButton').click();
    await bob.locator('.bubble').filter({ hasText: '<img src=x onerror=alert(1)>' }).waitFor();
    assert.equal(await bob.locator('.bubble img').count(), 0);
    await alice.waitForFunction(() => document.querySelector('.mine[data-read="true"]'));
    await alice.locator('#imageInput').setInputFiles({ name: 'test.png', mimeType: 'image/png', buffer: PNG });
    await bob.locator('.image-bubble img').waitFor();
    await bob.waitForFunction(() => document.querySelector('.image-bubble img')?.naturalWidth === 1);
    await alice.locator('#profileButton').click(); await alice.locator('#profileBio').fill('Perfil V25');
    await alice.locator('#profileAvatarFile').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: PNG }); await alice.locator('#saveProfile').click();
    await alice.locator('#profileMessage').filter({ hasText: 'Perfil salvo.' }).waitFor(); await alice.locator('#closeProfile').click();
    await alice.locator('#recordButton').click(); await alice.locator('#recordingBar').waitFor({ state: 'visible' });
    await alice.waitForTimeout(700); await alice.locator('#stopRecording').click(); await alice.locator('#audioPreviewBar').waitFor({ state: 'visible' });
    await alice.locator('#sendAudio').click(); await bob.locator('#messages audio').waitFor();
    await alice.locator('#shareButton').click(); await alice.locator('#startShare').click();
    await bob.locator('#sharedScreens button').filter({ hasText: 'Ver tela' }).waitFor();
    assert.equal(await eve.locator('#sharedScreens .shared-card').count(), 0);
    assert.equal(await alice.evaluate(() => window.captureCalls), 1);
    await bob.locator('#sharedScreens button').filter({ hasText: 'Ver tela' }).click();
    await bob.waitForFunction(() => document.querySelector('#screenVideo').srcObject?.getVideoTracks().length === 1, null, { timeout: 15000 });
    await bob.waitForFunction(() => viewerPeer?.localDescription?.type === 'answer');
    await alice.waitForFunction(() => [...sharePeers.values()].some(p=>p.remoteDescription?.type === 'answer'));
    if(!managedUdpBlocked) await bob.waitForFunction(() => viewerPeer?.connectionState === 'connected', null, { timeout: 15000 });
    await alice.locator('#closeScreen').click();
    await bob.locator('#screenOverlay').waitFor({ state: 'hidden' });
    assert.equal(await alice.evaluate(() => window.testScreenStream.getTracks().every(t => t.readyState === 'ended')), true);
    // Reload resumes using HttpOnly cookie. Abrupt transport loss reconnects automatically.
    await bob.reload(); await bob.locator('#chatApp').waitFor({ state: 'visible' });
    await bob.locator('[data-user="Alice"]').click(); await bob.locator('.image-bubble img').waitFor();
    await bob.evaluate(() => ws.close(4000, 'test disconnect'));
    await bob.waitForFunction(() => ws?.readyState === WebSocket.OPEN && document.querySelector('#onlineStatus').textContent.includes('ONLINE'), null, { timeout: 10000 });
    const count = await bob.locator('[data-mid]').count(); assert.equal(count, 3);
    const entries = await bob.evaluate(() => Object.keys(localStorage));
    assert.deepEqual(entries.sort(), ['chat.theme', 'pikachu.user']);
    await bob.locator('#logoutButton').click(); await bob.locator('#loginView').waitFor({ state: 'visible' });
    await bob.reload(); await bob.locator('#loginView').waitFor({ state: 'visible' });
    assert.deepEqual(errors, []); assert.deepEqual(dialogs, []);
    console.log('PASS browser: login, private messages, XSS escaping, read receipt, image, avatar, microphone recording/upload, cookie resume, WS reconnect, logout.');
    console.log('PASS WebRTC browser: synthetic capture only after click, private SDP offer/answer, remote track metadata, stream cleanup.');
    console.log(managedUdpBlocked ? 'SKIP ICE transport: managed Chromium policy WebRtcIPHandling=disable_non_proxied_udp; native picker, TURN and cross-network media remain untested.' : 'PASS ICE loopback connected; native picker, TURN and cross-network media remain untested.');
  } finally { await browser?.close(); await f.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
