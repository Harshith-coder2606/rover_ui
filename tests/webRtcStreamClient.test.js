import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { WebRtcStreamClient } from '../src/lib/services/webRtcStreamClient.ts';

const offerUrl = 'http://rover.invalid/api/nav/cameras/science/webrtc/offer';
const settle = () => new Promise(setImmediate);
let peers;

class FakePeer extends EventTarget {
    connectionState = 'new';
    iceGatheringState = 'complete';
    localDescription = null;
    ontrack = null;
    onconnectionstatechange = null;
    closed = false;
    constructor() { super(); peers.push(this); }
    addTransceiver() {}
    async createOffer() { return { type: 'offer', sdp: 'offer' }; }
    async setLocalDescription(offer) { this.localDescription = offer; }
    async setRemoteDescription(answer) { this.answer = answer; }
    changeState(state) {
        this.connectionState = state;
        this.onconnectionstatechange?.();
        this.dispatchEvent(new Event('connectionstatechange'));
    }
    close() { this.closed = true; this.changeState('closed'); }
}

beforeEach((t) => {
    peers = [];
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ type: 'answer', sdp: 'answer' }) }));
    const original = Object.getOwnPropertyDescriptor(globalThis, 'RTCPeerConnection');
    Object.defineProperty(globalThis, 'RTCPeerConnection', { value: FakePeer, writable: true, configurable: true });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'RTCPeerConnection', original);
        else delete globalThis.RTCPeerConnection;
    });
});

test('default offer targets 24 FPS and SDP alone is not a connected transport', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ type: 'answer', sdp: 'answer' }) }));
    const client = new WebRtcStreamClient();
    const pending = client.connect(offerUrl, { srcObject: null });
    await settle();
    assert.equal(JSON.parse(fetch.mock.calls[0].arguments[1].body).fps, 24);
    assert.equal(client.getState(), 'connecting');
    peers[0].changeState('connected');
    await pending;
    assert.equal(client.getState(), 'connected');
    await client.disconnect();
});

test('failed SDP negotiation closes its peer and reports the HTTP status', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, status: 500, json: async () => ({ detail: 'negotiation failed' }) }));
    const client = new WebRtcStreamClient();
    await assert.rejects(client.connect(offerUrl, { srcObject: null }), { message: 'negotiation failed', status: 500 });
    assert.equal(client.getState(), 'error');
    assert.equal(peers[0].closed, true);
});

test('remote description errors close the peer instead of leaving connecting forever', async (t) => {
    t.mock.method(FakePeer.prototype, 'setRemoteDescription', async () => { throw new Error('bad SDP'); });
    const client = new WebRtcStreamClient();
    await assert.rejects(client.connect(offerUrl, { srcObject: null }), /bad SDP/);
    assert.equal(client.getState(), 'error');
    assert.equal(peers[0].closed, true);
});

test('disconnect during ICE gathering cancels before posting an offer', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('must not fetch'); });
    const client = new WebRtcStreamClient();
    const pending = client.connect(offerUrl, { srcObject: null });
    peers[0].iceGatheringState = 'gathering';
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    await settle();
    await client.disconnect('http://rover.invalid/legacy-close-all');
    await rejected;
    assert.equal(client.getState(), 'disconnected');
    assert.equal(peers[0].closed, true);
    assert.equal(fetch.mock.callCount(), 0);
});

test('negotiation timeout releases a stuck native operation', async (t) => {
    t.mock.method(FakePeer.prototype, 'createOffer', () => new Promise(() => {}));
    const client = new WebRtcStreamClient(10);
    await assert.rejects(client.connect(offerUrl, { srcObject: null }), { name: 'TimeoutError' });
    assert.equal(client.getState(), 'error');
    assert.equal(peers[0].closed, true);
});

test('disconnect on a legacy backend never sends close-all DELETE', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ type: 'answer', sdp: 'answer' }) }));
    const client = new WebRtcStreamClient();
    const pending = client.connect(offerUrl, { srcObject: null });
    await settle();
    peers[0].changeState('connected');
    await pending;
    await client.disconnect(offerUrl.replace('/offer', ''));
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(peers[0].closed, true);
});

test('new backend cleanup targets only this peer at its original host', async (t) => {
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, method: options.method });
        return { ok: true, json: async () => ({ type: 'answer', sdp: 'answer', peer_id: 'viewer-one' }) };
    });
    const client = new WebRtcStreamClient();
    const pending = client.connect(offerUrl, { srcObject: null });
    await settle();
    peers[0].changeState('connected');
    await pending;
    await client.disconnect('http://another-rover.invalid/webrtc');
    assert.deepEqual(calls[1], { url: offerUrl.replace('/offer', '/connections/viewer-one'), method: 'DELETE' });
    await client.disconnect();
    assert.equal(calls.length, 2);
});

test('transport failure after negotiation notifies the consumer and closes the peer', async () => {
    const errors = [];
    const client = new WebRtcStreamClient();
    client.onError((error) => errors.push(error));
    const pending = client.connect(offerUrl, { srcObject: null });
    await settle();
    peers[0].changeState('connected');
    await pending;
    peers[0].changeState('failed');
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /transport failed/);
    assert.equal(client.getState(), 'error');
    assert.equal(peers[0].closed, true);
});

test('an old cancelled attempt cannot change a replacement connection', async (t) => {
    let resolveOld;
    const fetch = t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ type: 'answer', sdp: 'answer' }) }));
    t.mock.method(FakePeer.prototype, 'createOffer', function () {
        if (this === peers[0]) return new Promise(resolve => { resolveOld = resolve; });
        return Promise.resolve({ type: 'offer', sdp: 'new offer' });
    });
    const client = new WebRtcStreamClient();
    const old = assert.rejects(client.connect(offerUrl, { srcObject: null }), { name: 'AbortError' });
    await client.disconnect();
    const replacement = client.connect(offerUrl, { srcObject: null });
    await settle();
    peers[1].changeState('connected');
    await replacement;
    resolveOld({ type: 'offer', sdp: 'old offer' });
    await old;
    assert.equal(client.getState(), 'connected');
    assert.equal(peers[1].closed, false);
    assert.equal(fetch.mock.callCount(), 1);
    await client.disconnect();
});

test('streamless track events attach video and clear it on disconnect', async (t) => {
    class FakeMediaStream { constructor(tracks) { this.tracks = tracks; } }
    const original = Object.getOwnPropertyDescriptor(globalThis, 'MediaStream');
    Object.defineProperty(globalThis, 'MediaStream', { value: FakeMediaStream, configurable: true });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'MediaStream', original);
        else delete globalThis.MediaStream;
    });
    const video = { srcObject: null };
    const client = new WebRtcStreamClient();
    const pending = client.connect(offerUrl, video);
    await settle();
    const track = {};
    peers[0].ontrack({ streams: [], track });
    assert.deepEqual(video.srcObject.tracks, [track]);
    peers[0].changeState('connected');
    await pending;
    await client.disconnect();
    assert.equal(video.srcObject, null);
});

test('advertised adaptive backend receives interval feedback; disconnect stops polling', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        calls.push({ url, options });
        return { ok: true, json: async () => url.endsWith('/feedback')
            ? { scale: 0.85 }
            : { type: 'answer', sdp: 'answer', peer_id: 'one', target_fps: 60, adaptive_quality: true } };
    });
    let sample = 0;
    FakePeer.prototype.getStats = async () => {
        const n = sample++;
        return new Map([['video', { id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: n * 2000, framesDecoded: n * 60, bytesReceived: n * 250000, packetsReceived: n * 100 }]]);
    };
    t.after(() => delete FakePeer.prototype.getStats);
    const metrics = [];
    const client = new WebRtcStreamClient();
    client.onMetrics(value => metrics.push(value));
    const connecting = client.connect(offerUrl, { srcObject: null }, 60);
    await settle();
    peers[0].changeState('connected');
    await connecting;
    await settle();
    t.mock.timers.tick(2000);
    await settle();
    const feedback = calls.find(call => call.url.endsWith('/feedback'));
    assert.equal(JSON.parse(feedback.options.body).received_fps, 30);
    assert.equal(metrics[0].scale, 0.85);
    assert.equal(metrics[0].targetFps, 60);
    await client.disconnect();
    const count = calls.length;
    t.mock.timers.tick(4000);
    await settle();
    assert.equal(calls.length, count);
});
