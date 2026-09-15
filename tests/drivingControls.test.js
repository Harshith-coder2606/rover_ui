import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import { GameDriveController, isTypingTarget } from '../src/lib/services/gameDriveController.js';
import { DriveCommandQueue } from '../src/lib/services/driveCommandQueue.js';

// Exercise the actual component's handlers with fake timers and motor outputs.
// This does not emulate Svelte rendering/reactivity or send physical commands.
const source = readFileSync(new URL('../src/lib/components/sections/DrivingControls.svelte', import.meta.url), 'utf8')
    .split('<script lang="ts">')[1].split('</script>')[0]
    .replace(/^\s*import\s[\s\S]*?from\s*['"][^'"]+['"];?/gm, '');
const script = stripTypeScriptTypes(source) + `
globalThis.harness = {
    handleKeyDown, handleKeyUp, handleFocusIn, handleVisibilityChange, gameSafetyStop,
    toggleGameControls, toggleControlMode, handleEmergencyStop,
    state: () => ({ gameControls, cruiseLocked, linearVelocity, angularVelocity, driveError }),
};`;

function setup() {
    let now = 0;
    const intervals = new Map(); let id = 0;
    const mounts = [], effects = [], destroys = [], sent = [];
    const context = {
        GameDriveController, DriveCommandQueue, isTypingTarget, AbortSignal, console,
        $state: value => value, $props: () => ({}), $effect: fn => effects.push(fn), untrack: fn => fn(),
        $isRosConnected: true, $apiStatus: 'connected', $roverApiUrl: 'http://mock.invalid',
        performance: { now: () => now },
        setInterval: (fn, period) => { intervals.set(++id, { fn, period, next: now + period }); return id; },
        clearInterval: id => intervals.delete(id),
        window: { addEventListener() {}, removeEventListener() {} },
        document: { hidden: false, addEventListener() {}, removeEventListener() {} },
        HTMLInputElement: class {}, HTMLTextAreaElement: class {},
        onMount: fn => mounts.push(fn), onDestroy: fn => destroys.push(fn),
        publishCmdVel: async (linear, angular) => { sent.push({ linear, angular }); },
        stopRover: async () => { sent.push({ emergency: true }); return true; },
        commandedVelocity: { set() {} }, logCommand() {},
        connectArduino: async () => {}, disconnectArduino: async () => {},
        getArduinoStatus: async () => ({ connected: true }),
        sendArduinoCommand: async command => { sent.push({ command }); }, stopArduino: async () => {},
    };
    runInNewContext(script, context);
    mounts.forEach(fn => fn());
    const h = context.harness;
    const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
    const advance = async duration => {
        for (let elapsed = 0; elapsed < duration; elapsed += 50) {
            now += 50;
            for (const timer of [...intervals.values()]) if (now >= timer.next) { timer.next += timer.period; timer.fn(); }
            await settle();
        }
    };
    const key = (value, extras = {}) => ({ key: value, repeat: false, preventDefault() {}, target: {}, ...extras });
    return { h, context, advance, key, settle, sent, effects, destroys };
}

test('Classic remains default and retains speed after releasing W', async () => {
    const { h, advance, key } = setup();
    assert.equal(h.state().gameControls, false);
    h.handleKeyDown(key('w')); await advance(500);
    h.handleKeyUp(key('w'));
    const speed = h.state().linearVelocity; await advance(300);
    assert.equal(h.state().linearVelocity, speed);
});

test('Game UI holds ramp speed, lock survives releases, and unrelated key clears it', async () => {
    const { h, advance, key, settle, sent } = setup();
    await h.toggleGameControls();
    h.handleKeyDown(key('w')); h.handleKeyDown(key('a')); await advance(500);
    const before = h.state(); assert.ok(before.linearVelocity > 0 && before.angularVelocity > 0);
    h.handleKeyDown(key('l')); h.handleKeyUp(key('w')); h.handleKeyUp(key('a')); await advance(500);
    assert.equal(h.state().cruiseLocked, true);
    assert.equal(h.state().linearVelocity, before.linearVelocity);
    h.handleKeyDown(key('q')); await settle();
    assert.equal(h.state().cruiseLocked, false);
    assert.deepEqual(sent.at(-1), { linear: 0, angular: 0 });
});

test('typing, blur, hidden page and unmount clear Game motion and cruise', async () => {
    for (const action of ['typing', 'blur', 'hidden', 'unmount']) {
        const { h, context, advance, key, destroys, settle } = setup();
        await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500); h.handleKeyDown(key('l'));
        if (action === 'typing') h.handleFocusIn({ target: { closest: () => ({}) } });
        if (action === 'blur') h.gameSafetyStop();
        if (action === 'hidden') { context.document.hidden = true; h.handleVisibilityChange(); }
        if (action === 'unmount') destroys.forEach(fn => fn());
        await settle();
        assert.equal(h.state().linearVelocity, 0, action);
        assert.equal(h.state().cruiseLocked, false, action);
    }
});

test('a key in an editable field unlocks but never starts driving', async () => {
    const { h, advance, key } = setup();
    await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500);
    h.handleKeyDown(key('l')); h.handleKeyUp(key('w'));
    h.handleKeyDown(key('s', { target: { closest: () => ({}) } })); await advance(200);
    assert.equal(h.state().cruiseLocked, false); assert.equal(h.state().linearVelocity, 0);
});

test('toggling back to Classic clears lock and pending velocity', async () => {
    const { h, advance, key } = setup();
    await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500); h.handleKeyDown(key('l'));
    await h.toggleGameControls(); await advance(300);
    assert.equal(h.state().gameControls, false); assert.equal(h.state().linearVelocity, 0);
});

test('a key held through a Game-to-Classic switch must be released before moving again', async () => {
    const { h, advance, key } = setup();
    await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500);
    await h.toggleGameControls();
    h.handleKeyDown(key('w', { repeat: true })); await advance(200);
    assert.equal(h.state().linearVelocity, 0);
    h.handleKeyUp(key('w')); h.handleKeyDown(key('w')); await advance(200);
    assert.ok(h.state().linearVelocity > 0);
});

test('movement failure clears cruise, reports an error, and blocks automatic restart', async () => {
    const { h, context, advance, key, settle } = setup();
    await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500); h.handleKeyDown(key('l'));
    await settle(); context.publishCmdVel = async () => { throw Error('network down'); };
    await advance(300);
    assert.match(h.state().driveError, /network down/);
    assert.equal(h.state().cruiseLocked, false); assert.equal(h.state().linearVelocity, 0);
    h.handleKeyDown(key('s')); await advance(200);
    assert.equal(h.state().linearVelocity, 0);
});

test('connection loss disarms and reconnecting does not resume old input', async () => {
    const { h, context, advance, key, effects } = setup();
    await h.toggleGameControls(); h.handleKeyDown(key('w')); await advance(500); h.handleKeyDown(key('l'));
    context.$isRosConnected = false; effects.forEach(fn => fn());
    assert.equal(h.state().linearVelocity, 0);
    context.$isRosConnected = true; effects.forEach(fn => fn()); await advance(200);
    assert.equal(h.state().linearVelocity, 0);
});

test('Arduino Game mode sends bounded single-axis commands and reserves L for lock', async () => {
    const { h, advance, key, sent, settle } = setup();
    await h.toggleControlMode(); await h.toggleGameControls();
    h.handleKeyDown(key('w')); await advance(500); h.handleKeyDown(key('l'));
    h.handleKeyUp(key('w')); await advance(200);
    assert.equal(h.state().cruiseLocked, true);
    assert.ok(sent.some(item => /^w:\d+$/.test(item.command ?? '')));
    assert.equal(sent.some(item => item.command === 'l'), false);
    h.handleKeyDown(key('q')); await settle();
    assert.equal(sent.at(-1).command, 'x:0');
});
