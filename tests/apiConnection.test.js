import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { get } from 'svelte/store';
import * as api from '../src/lib/services/roverApi.js';

let store;
let instance = 0;
const ok = () => ({ ok: true, json: async () => ({ cameras: [], status: {} }) });

beforeEach(async () => {
    // Fresh connection state for each test, without changing production code.
    store = await import(`../src/lib/stores/apiStore.js?test=${instance++}`);
    api.setApiBaseUrl(api.DEFAULT_API_URL);
});

test('startup badge and request service share the same default', () => {
    assert.equal(get(store.roverApiUrl), api.DEFAULT_API_URL);
    assert.equal(api.getApiBaseUrl(), api.DEFAULT_API_URL);
    assert.equal(get(store.apiStatus), 'disconnected');
});

test('auto-connect configures camera and ROS requests before publishing connected', async (t) => {
    api.setApiBaseUrl('http://old-rover.invalid:6767');
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url) => {
        requests.push(url);
        return ok();
    });
    let dependentRequests;
    const unsubscribe = store.apiStatus.subscribe((status) => {
        if (status !== 'connected') return;
        assert.equal(api.getApiBaseUrl(), get(store.roverApiUrl));
        dependentRequests = Promise.all([api.detectCameras(), api.getRosStatus()]);
    });
    t.after(unsubscribe);

    assert.equal(await store.autoConnect(), true);
    await dependentRequests;
    assert.deepEqual(requests, [
        `${api.DEFAULT_API_URL}/api/status`,
        `${api.DEFAULT_API_URL}/api/nav/cameras/detect?max_cameras=10`,
        `${api.DEFAULT_API_URL}/api/ros/status`,
    ]);
});

test('manual connection normalizes and installs the URL before notifying subscribers', async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        requests.push(url);
        assert.ok(options.signal instanceof AbortSignal);
        return ok();
    });
    const unsubscribe = store.apiStatus.subscribe((status) => {
        if (status === 'connected') {
            assert.equal(api.getApiBaseUrl(), 'http://new-rover.invalid:6767');
            assert.equal(get(store.roverApiUrl), api.getApiBaseUrl());
        }
    });
    t.after(unsubscribe);

    assert.equal(await store.testConnection('  http://new-rover.invalid:6767///  '), true);
    assert.deepEqual(requests, ['http://new-rover.invalid:6767/api/status']);
});

test('failed manual health check does not switch the request service', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
    assert.equal(await store.testConnection('http://unavailable.invalid'), false);
    assert.equal(get(store.apiStatus), 'error');
    assert.equal(api.getApiBaseUrl(), api.DEFAULT_API_URL);
    assert.equal(get(store.roverApiUrl), api.DEFAULT_API_URL);
});

test('failed automatic health check leaves manual connection available', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => { throw new Error('timeout'); });
    assert.equal(await store.autoConnect(), false);
    assert.equal(get(store.apiStatus), 'disconnected');
});

test('late auto-connect cannot overwrite a newer manual connection', async (t) => {
    let resolveAuto;
    t.mock.method(globalThis, 'fetch', (url) => url.startsWith(api.DEFAULT_API_URL)
        ? new Promise((resolve) => { resolveAuto = resolve; })
        : Promise.resolve(ok()));

    const automatic = store.autoConnect();
    assert.equal(await store.testConnection('http://new-rover.invalid'), true);
    resolveAuto(ok());
    assert.equal(await automatic, false);
    assert.equal(api.getApiBaseUrl(), 'http://new-rover.invalid');
    assert.equal(get(store.roverApiUrl), 'http://new-rover.invalid');
    assert.equal(get(store.apiStatus), 'connected');
});

test('manual connection suppresses the delayed startup attempt', async (t) => {
    const fetch = t.mock.method(globalThis, 'fetch', async () => ok());
    assert.equal(await store.testConnection('http://new-rover.invalid'), true);
    await store.autoConnect();
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(api.getApiBaseUrl(), 'http://new-rover.invalid');
});

test('disconnect invalidates an outstanding connection attempt', async (t) => {
    let resolveHealth;
    t.mock.method(globalThis, 'fetch', () => new Promise((resolve) => { resolveHealth = resolve; }));
    const connecting = store.testConnection('http://new-rover.invalid');
    store.disconnectFromRover();
    resolveHealth(ok());
    assert.equal(await connecting, false);
    assert.equal(get(store.apiStatus), 'disconnected');
    assert.equal(api.getApiBaseUrl(), api.DEFAULT_API_URL);
});
