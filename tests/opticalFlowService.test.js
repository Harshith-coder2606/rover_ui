import assert from 'node:assert/strict';
import { test } from 'node:test';
import cvModule from '@techstark/opencv-js';
import { OpticalFlowService } from '../src/lib/services/opticalFlowService.ts';

const cv = await cvModule;
const width = 320, height = 240;
function frame(dx = 0, dy = 0, blank = false) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const sx = x - dx, sy = y - dy;
        // Deterministic textured scene, shifted exactly by dx/dy between frames.
        const value = blank || sx < 0 || sy < 0 ? 0 :
            ((Math.imul(sx + 1, 73856093) ^ Math.imul(sy + 1, 19349663)) >>> 9) % 256;
        const i = (y * width + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = value;
        data[i + 3] = 255;
    }
    return { data, width, height };
}
function setup() {
    const service = new OpticalFlowService();
    const live = new Set();
    const track = value => {
        live.add(value);
        const remove = value.delete.bind(value);
        value.delete = () => { assert.ok(live.delete(value), 'native object deleted once'); remove(); };
        return value;
    };
    service.cv = new Proxy(cv, {
        get(target, prop) {
            const value = target[prop];
            if (['Mat', 'FastFeatureDetector', 'KeyPointVector'].includes(prop))
                return new Proxy(value, { construct: (Type, args) => track(new Type(...args)) });
            if (['matFromArray', 'matFromImageData'].includes(prop))
                return (...args) => track(value(...args));
            return value;
        }
    });
    let image = frame();
    const state = {
        video: {}, ctx: { drawImage() {}, getImageData: () => image },
        previousGray: null, previousPoints: null, running: true,
        frameCount: 0, lastTimestamp: 0, callbackId: null
    };
    service.states.set('science', state);
    return { service, state, live, image: value => { image = value; } };
}

test('real OpenCV measures a known translation and bounds feature workload', () => {
    const { service, state, live, image } = setup();
    assert.equal(service.processFrame('science', state, 1), null);
    assert.ok(state.previousPoints.rows > 30 && state.previousPoints.rows <= 240);
    image(frame(3, 2));
    const result = service.processFrame('science', state, 1.04);
    assert.ok(result.trackedPoints > 30);
    assert.ok(Math.abs(result.meanDx - 3) < 0.3, `dx ${result.meanDx}`);
    assert.ok(Math.abs(result.meanDy - 2) < 0.3, `dy ${result.meanDy}`);
    assert.equal(result.points.length, result.trackedPoints);
    assert.equal(result.topPoints + result.middlePoints + result.bottomPoints, result.trackedPoints);
    assert.ok(Math.abs(result.deltaTime - 0.04) < 1e-9);
    assert.equal(live.size, 2, 'only the next reference frame and points remain');
    for (let i = 0; i < 40; i++) service.processFrame('science', state, 1.08 + i * 0.04);
    assert.equal(live.size, 2, 'native allocations stay bounded across refreshes');
    service.stopAll();
    assert.equal(live.size, 0);
});

test('blank frames, duplicate frames and media discontinuities re-seed safely', () => {
    const { service, state, live, image } = setup();
    image(frame(0, 0, true));
    for (let i = 0; i < 4; i++) assert.equal(service.processFrame('science', state, 1 + i * 0.04), null);
    assert.equal(live.size, 2);
    image(frame());
    service.processFrame('science', state, 1.2);
    const count = state.frameCount;
    assert.equal(service.processFrame('science', state, 1.2), null);
    assert.equal(state.frameCount, count);
    assert.equal(service.processFrame('science', state, 2), null);
    assert.equal(service.processFrame('science', state, 0), null);
    service.stopAll(); assert.equal(live.size, 0);
});

test('rejected tracks never enter reported or next-frame points; empty bands are unavailable', () => {
    const { service, state, live } = setup();
    service.processFrame('science', state, 1);
    state.previousPoints.delete();
    const positions = Array.from({ length: 40 }, (_, i) => [30 + i * 4, 30]).flat();
    state.previousPoints = service.cv.matFromArray(40, 1, cv.CV_32FC2, positions);
    const real = service.cv;
    let pass = 0;
    service.cv = new Proxy(real, { get(target, prop) {
        if (prop !== 'calcOpticalFlowPyrLK') return target[prop];
        return (_prev, _next, _points, output, status, error) => {
            const backward = pass++ % 2 === 1;
            const values = positions.map((value, i) => backward ? value : value + (i < 68 ? (i % 2 ? 2 : 3) : 20));
            if (backward) values[78] = NaN;
            const points = cv.matFromArray(40, 1, cv.CV_32FC2, values);
            const flags = cv.matFromArray(40, 1, cv.CV_8UC1, Array.from({ length: 40 }, (_, i) => i === 38 ? 0 : 1));
            const errors = cv.Mat.zeros(40, 1, cv.CV_32F);
            points.copyTo(output); flags.copyTo(status); errors.copyTo(error);
            points.delete(); flags.delete(); errors.delete();
        };
    }});
    const result = service.processFrame('science', state, 1.04);
    assert.equal(result.trackedPoints, 34);
    assert.equal(result.points.length, 34);
    assert.equal(state.previousPoints.rows, 34);
    assert.equal(result.meanDx, 3); assert.equal(result.meanDy, 2);
    assert.equal(result.topPoints, 34);
    assert.equal(result.middleMeanDy, null); assert.equal(result.bottomMeanDy, null);
    service.stopAll(); assert.equal(live.size, 0);
});

test('conversion and tracking exceptions release all temporary native allocations', () => {
    for (const operation of ['cvtColor', 'calcOpticalFlowPyrLK']) {
        const { service, state, live } = setup();
        service.processFrame('science', state, 1);
        const real = service.cv;
        service.cv = new Proxy(real, { get: (target, prop) => prop === operation ?
            () => { throw new Error('injected native failure'); } : target[prop] });
        assert.throws(() => service.processFrame('science', state, 1.04), /injected/);
        assert.equal(live.size, 2, 'previous reference remains valid until caller resets');
        service.stopAll(); assert.equal(live.size, 0);
    }
});

test('stopping cancels queued video callbacks and stale callbacks cannot reschedule', t => {
    const { service, live } = setup();
    service.states.clear();
    let callback, cancelled;
    const video = {
        requestVideoFrameCallback(fn) { callback = fn; return 7; },
        cancelVideoFrameCallback(id) { cancelled = id; }
    };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => ({ getContext: () => ({}) }) } });
    t.after(() => {
        if (original) Object.defineProperty(globalThis, 'document', original);
        else delete globalThis.document;
    });
    service.start('science', video);
    service.stop('science');
    assert.equal(cancelled, 7);
    callback(0, { mediaTime: 0 });
    assert.equal(service.states.size, 0); assert.equal(live.size, 0);
    assert.throws(() => service.start('old-browser', {}), /requestVideoFrameCallback/);
    assert.equal(service.states.size, 0);
});
