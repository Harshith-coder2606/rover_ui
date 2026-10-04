import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

// Actual component handlers with fake peers; no browser or camera control.
const source = readFileSync(new URL('../src/lib/components/panels/CameraPanel.svelte', import.meta.url), 'utf8')
    .split('<script lang="ts">')[1].split('</script>')[0]
    .replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
const script = stripTypeScriptTypes(source) + `
globalThis.harness = {
    startWebRtcStream, stopWebRtcStream, stopAllCameras, webRtcLabel,
    prepare() { activeCameras.add('science'); streamingModes.set('science', 'webrtc'); videoRefs.science = {}; },
    mode(value) { streamingModes.set('science', value); },
    feedback: () => feedbackMessage,
};`;

function setup() {
    const peers = [], timers = [], mounts = [], flowStarts = [], flowStops = [];
    let resolveFlow;
    class OpticalFlowService {
        initialize() { return new Promise(resolve => { resolveFlow = resolve; }); }
        start(name, video) { flowStarts.push({ name, video }); }
        stop(name) { flowStops.push(name); }
        stopAll() { flowStops.push('*'); }
    }
    class Peer {
        state = 'disconnected';
        constructor() { peers.push(this); }
        getState() { return this.state; }
        onStateChange(fn) { this.stateChanged = fn; }
        onMetrics(fn) { this.metrics = fn; }
        onError(fn) { this.error = fn; }
        change(state) { this.state = state; this.stateChanged(state); }
        connect() { this.change('connecting'); return new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; }); }
        async disconnect() { this.change('disconnected'); }
    }
    const context = {
        $state: value => value, $effect() {}, untrack: fn => fn(), onMount: fn => mounts.push(fn), OpticalFlowService, WebRtcStreamClient: Peer, WEBRTC_TARGET_FPS: 24,
        roverApi: { getCameraWebRtcOfferUrl: () => 'http://mock.invalid/offer', getCameraWebRtcDeleteUrl: () => null, stopAllCameras: async () => {} },
        console: { log() {}, error() {}, warn() {} },
        setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout() {},
        setInterval() { return 1; }, clearInterval() {},
    };
    runInNewContext(script, context);
    context.harness.prepare();
    return { h: context.harness, peers, timers, mounts, flowStarts, flowStops, ready: () => resolveFlow() };
}

test('camera badge is live only with connected transport and received frames', async () => {
    const { h, peers } = setup();
    h.startWebRtcStream('science');
    assert.equal(h.webRtcLabel('science'), 'WebRTC · connecting');
    peers[0].change('connected'); peers[0].resolve(); await Promise.resolve();
    assert.equal(h.webRtcLabel('science'), 'WebRTC · waiting for frames');
    peers[0].metrics({ fps: 24 });
    assert.equal(h.webRtcLabel('science'), 'LIVE WebRTC');
    peers[0].metrics({ fps: 0 });
    assert.equal(h.webRtcLabel('science'), 'WebRTC · waiting for frames');
    peers[0].change('error');
    assert.equal(h.webRtcLabel('science'), 'WebRTC · connection failed');
});

test('duplicate starts do not create extra viewers and late starts respect mode', () => {
    const { h, peers } = setup();
    h.startWebRtcStream('science'); h.startWebRtcStream('science');
    assert.equal(peers.length, 1);
    peers[0].change('connected'); h.startWebRtcStream('science');
    assert.equal(peers.length, 1);
    h.mode('mjpeg'); h.startWebRtcStream('science');
    assert.equal(peers.length, 1);
});

test('retry banner retains the actual negotiation error', async () => {
    const { h, peers, timers } = setup();
    h.startWebRtcStream('science'); peers[0].change('error');
    peers[0].reject(Object.assign(new Error('No local ICE address'), { status: 500 }));
    await Promise.resolve(); await Promise.resolve();
    assert.match(h.feedback(), /No local ICE address.*retrying 'science'/);
    assert.ok(timers.some(timer => timer.delay === 5000));
    await h.stopWebRtcStream('science');
    peers[0].metrics({ fps: 24 }); peers[0].change('connected');
    assert.notEqual(h.webRtcLabel('science'), 'LIVE WebRTC');
});


test('a camera connected before OpenCV loads starts diagnostics when ready', async () => {
    const { h, peers, mounts, flowStarts, flowStops, ready } = setup();
    const cleanup = mounts[0]();
    h.startWebRtcStream('science');
    peers[0].change('connected'); peers[0].resolve(); await Promise.resolve();
    assert.equal(flowStarts.length, 0);
    ready(); await Promise.resolve();
    assert.equal(flowStarts.length, 1);
    assert.equal(flowStarts[0].name, 'science');
    peers[0].change('error');
    assert.ok(flowStops.includes('science'));
    cleanup();
});

test('late initialization cannot start processing after unmount or mode change', async () => {
    for (const action of ['unmount', 'mode']) {
        const { h, peers, mounts, flowStarts, ready } = setup();
        const cleanup = mounts[0]();
        h.startWebRtcStream('science');
        peers[0].change('connected'); peers[0].resolve(); await Promise.resolve();
        if (action === 'unmount') cleanup(); else h.mode('mjpeg');
        ready(); await Promise.resolve();
        assert.equal(flowStarts.length, 0);
    }
});

test('Stop All releases optical flow even while backend shutdown is pending', async () => {
    const { h, flowStops } = setup();
    const stop = h.stopAllCameras();
    assert.deepEqual(flowStops, ['*']);
    await stop;
});
