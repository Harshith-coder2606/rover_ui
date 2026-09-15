import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectCameraMode } from '../src/lib/services/cameraStreamProfile.js';
import { JpegQualityController } from '../src/lib/services/jpegQualityController.js';
import { WebRtcStatsSampler } from '../src/lib/services/webRtcMetrics.ts';

const formats = [
    { fourcc: 'YUYV', resolutions: [{ width: 1280, height: 720, frame_rates: [10, 5] }] },
    { fourcc: 'MJPG', resolutions: [{ width: 1280, height: 720, frame_rates: [60, 30] }, { width: 1920, height: 1080, frame_rates: [15] }] },
];

test('FPS and pixel format are selected for this camera and this resolution', () => {
    assert.equal(selectCameraMode(formats, 1280, 720).fps, 60);
    assert.equal(selectCameraMode(formats, 1280, 720).pixelFormat, 'MJPG');
    assert.equal(selectCameraMode(formats, 1920, 1080).fps, 15);
    assert.equal(selectCameraMode([formats[0]], 1280, 720).fps, 10);
});

test('unknown mode keeps a reported fallback without inventing capability', () => {
    assert.deepEqual(selectCameraMode([], 640, 480, 15), { fps: 15, pixelFormat: undefined, advertisedFps: null, verified: false });
    assert.equal(selectCameraMode([], 640, 480, NaN).fps, 30);
});

test('advertised FPS remains visible when the stream ceiling is lower', () => {
    const result = selectCameraMode([{ fourcc: 'MJPG', resolutions: [{ width: 640, height: 480, frame_rates: [120] }] }], 640, 480);
    assert.equal(result.fps, 60);
    assert.equal(result.advertisedFps, 120);
});

test('JPEG adaptation reduces quality first and recovers slowly per camera', () => {
    const slow = new JpegQualityController(85);
    const healthy = new JpegQualityController(85);
    assert.equal(slow.update(10, 30), 85);
    slow.update(10, 30);
    assert.equal(slow.update(10, 30), 75);
    assert.equal(healthy.quality, 85);
    for (let i = 0; i < 5; i++) assert.equal(slow.update(30, 30), 75);
    assert.equal(slow.update(30, 30), 80);
    for (let i = 0; i < 50; i++) slow.update(0, 30);
    assert.equal(slow.quality, 35);
});

test('mode selection does not synthesize 60 FPS when 30 is the supported rate below the ceiling', () => {
    const result = selectCameraMode([{ fourcc: 'MJPG', resolutions: [{ width: 640, height: 480, frame_rates: [120, 30] }] }], 640, 480);
    assert.equal(result.fps, 30);
});

const stats = (values = {}) => new Map([['video', {
    id: 'video', type: 'inbound-rtp', kind: 'video', timestamp: 0,
    framesDecoded: 0, bytesReceived: 0, packetsReceived: 0, packetsLost: 0, totalDecodeTime: 0, jitter: 0,
    ...values,
}]]);

test('WebRTC metrics calculate interval FPS, bitrate, loss and decode cost', () => {
    const sampler = new WebRtcStatsSampler();
    assert.equal(sampler.sample(stats()), null);
    const sample = sampler.sample(stats({ timestamp: 2000, framesDecoded: 60, bytesReceived: 250000, packetsReceived: 98, packetsLost: 2, totalDecodeTime: 0.12, jitter: 0.01 }));
    assert.deepEqual(sample, { fps: 30, bitrateBps: 1000000, lossRatio: 0.02, jitterMs: 10, decodeMs: 2 });
});

test('stat resets and reordered packets do not produce negative throughput/loss', () => {
    const sampler = new WebRtcStatsSampler();
    sampler.sample(stats({ framesDecoded: 60, bytesReceived: 10000, packetsReceived: 100, packetsLost: 10 }));
    assert.equal(sampler.sample(stats({ timestamp: 2000 })), null);
    const sample = sampler.sample(stats({ timestamp: 4000, packetsReceived: 100, packetsLost: -2 }));
    assert.equal(sample.lossRatio, 0);
    assert.equal(sample.fps, 0);
});
