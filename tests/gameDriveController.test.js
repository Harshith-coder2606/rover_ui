import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameDriveController, isTypingTarget } from '../src/lib/services/gameDriveController.js';
import { DriveCommandQueue } from '../src/lib/services/driveCommandQueue.js';

function advance(driver, from, to, step = 50) {
    for (let now = from + step; now <= to; now += step) driver.tick(now);
    return driver.snapshot();
}

test('longer holds accelerate faster, independent of keyboard repeat', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0);
    const first = advance(driver, 0, 500).linear;
    driver.keyDown('w', 500, { repeat: true });
    const second = advance(driver, 500, 1000).linear;
    assert.ok(first > 0);
    assert.ok(second - first > first);
    assert.equal(advance(driver, 1000, 5000).linear, 1);
});

test('simultaneous steering works and releasing each key stops only that axis', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0); driver.keyDown('a', 0);
    advance(driver, 0, 500);
    driver.keyUp('w', 500);
    assert.equal(driver.linear, 0);
    assert.ok(driver.angular > 0);
    driver.keyUp('a', 500);
    assert.equal(driver.angular, 0);
});

test('L freezes both velocities across key release and held-key autorepeat', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0); driver.keyDown('d', 0); advance(driver, 0, 500);
    const before = driver.snapshot();
    driver.keyDown('l', 500);
    driver.keyDown('w', 550, { repeat: true });
    driver.keyUp('w', 550); driver.keyUp('d', 550);
    advance(driver, 500, 1500);
    assert.equal(driver.locked, true);
    assert.equal(driver.linear, before.linear);
    assert.equal(driver.angular, before.angular);
});

test('every new non-L key cancels cruise immediately, including unrelated and modifier keys', () => {
    for (const key of ['w', 's', 'a', 'd', 'q', 'Shift', 'Tab', ' ', 'Escape']) {
        const driver = new GameDriveController();
        driver.keyDown('w', 0); advance(driver, 0, 500);
        driver.keyDown('l', 500); driver.keyUp('w', 500);
        driver.keyDown(key, 550);
        assert.equal(driver.locked, false, key);
        assert.equal(driver.linear, 0, key);
        assert.equal(driver.angular, 0, key);
    }
});

test('L toggles off, while locking at standstill has no effect', () => {
    const driver = new GameDriveController();
    driver.keyDown('l', 0); assert.equal(driver.locked, false);
    driver.keyDown('w', 0); advance(driver, 0, 500);
    driver.keyDown('l', 500); driver.keyDown('l', 550);
    assert.equal(driver.locked, false); assert.equal(driver.linear, 0);
});

test('opposite keys cancel and reversals restart their acceleration from zero', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0); advance(driver, 0, 1000);
    driver.keyDown('s', 1000); assert.equal(driver.linear, 0);
    driver.keyUp('w', 1000); advance(driver, 1000, 1100);
    assert.ok(driver.linear < 0 && driver.linear > -0.03);
});

test('stop clears cruise and requires held keys to be released before restarting', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0); advance(driver, 0, 500); driver.stop();
    driver.keyDown('w', 500, { repeat: true }); advance(driver, 500, 600);
    assert.equal(driver.linear, 0);
    driver.keyUp('w', 600); driver.keyDown('w', 600); advance(driver, 600, 700);
    assert.ok(driver.linear > 0);
});

test('suspended event loops disarm cruise and do not catch up at high speed', () => {
    const driver = new GameDriveController();
    driver.keyDown('w', 0); advance(driver, 0, 500); driver.keyDown('l', 500);
    driver.tick(5000);
    assert.equal(driver.linear, 0); assert.equal(driver.locked, false);
});

test('Arduino single-direction mode never creates diagonal commands', () => {
    const driver = new GameDriveController({ singleDirection: true });
    driver.keyDown('w', 0); advance(driver, 0, 500);
    driver.keyDown('a', 500); advance(driver, 500, 600);
    assert.equal(driver.linear, 0); assert.ok(driver.angular > 0);
    driver.keyUp('a', 600); assert.equal(driver.angular, 0);
});

test('typing target guard includes selects and nested editable content', () => {
    let selector;
    assert.equal(isTypingTarget({ closest: value => { selector = value; return {}; } }), true);
    assert.match(selector, /select/); assert.match(selector, /contenteditable/);
    assert.equal(isTypingTarget(null), false);
});

test('command queue coalesces movement and preserves stop before subsequent motion', async () => {
    const sent = []; let release;
    const queue = new DriveCommandQueue(async command => {
        sent.push(command.linear);
        if (sent.length === 1) await new Promise(resolve => { release = resolve; });
    }, error => { throw error; });
    queue.submit({ linear: 0.1, angular: 0 });
    await Promise.resolve();
    queue.submit({ linear: 0.2, angular: 0 });
    queue.submit({ linear: 0.3, angular: 0 });
    queue.submit({ linear: 0, angular: 0 });
    const finished = queue.submit({ linear: -0.1, angular: 0 });
    release(); await finished;
    assert.deepEqual(sent, [0.1, 0, -0.1]);
});

test('command failures discard queued movement and report once', async () => {
    const errors = []; const sent = [];
    const queue = new DriveCommandQueue(async command => { sent.push(command); throw Error('offline'); }, error => errors.push(error));
    const finished = queue.submit({ linear: 1, angular: 0 });
    await finished;
    assert.equal(errors.length, 1); assert.equal(sent.length, 1);
    assert.equal(queue.pending, null);
});
