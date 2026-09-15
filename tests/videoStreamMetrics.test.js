import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VideoStreamClient } from '../src/lib/services/videoStreamService.ts';

function setup(t) {
    const previousWindow = globalThis.window;
    globalThis.window = globalThis;
    t.after(() => { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
    t.mock.timers.enable({ apis: ['setInterval', 'Date'], now: 100000 });
    const client = new VideoStreamClient({ fps: 30 });
    const sent = [];
    client.ws = { send: message => sent.push(JSON.parse(message)) };
    client.handleOpen();
    return { client, sent };
}

test('each WebSocket metric update is a new snapshot for reactive consumers', t => {
    const { client } = setup(t);
    const samples = [];
    client.onMetrics(metrics => samples.push(metrics));
    client.metrics.framesReceived = 30;
    t.mock.timers.tick(1000);
    client.metrics.framesReceived = 60;
    t.mock.timers.tick(1000);
    assert.notEqual(samples[0], samples[1]);
    assert.equal(samples[0].framesReceived, 30);
    assert.equal(samples[1].framesReceived, 60);
    t.mock.timers.tick(1000);
    assert.equal(samples[2].fps, 0, 'stalled streams must not retain stale FPS');
});

test('camera JPEG quality adapts through the existing control protocol without reducing FPS', t => {
    const { client, sent } = setup(t);
    const frame = new ArrayBuffer(25);
    const view = new DataView(frame);
    view.setUint32(0, 0x524F5652, true);
    view.setBigInt64(8, BigInt(Date.now()) * 1000n, true);
    client.handleFrame(frame);
    for (let i = 0; i < 3; i++) t.mock.timers.tick(1000);
    assert.deepEqual(sent, [{ type: 'control', action: 'set_quality', params: { quality: 75 } }]);
    assert.equal(client.getMetrics().targetFps, 30);
    assert.equal(client.getMetrics().quality, 75);
});
