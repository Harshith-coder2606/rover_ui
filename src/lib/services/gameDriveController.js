const AXES = { w: ['linear', 1], s: ['linear', -1], a: ['angular', 1], d: ['angular', -1] };

/** Pure input model. No timers, network, or hardware access. Values stay within ±1. */
export class GameDriveController {
    constructor({ singleDirection = false } = {}) {
        this.singleDirection = singleDirection;
        this.held = new Set();
        this.blocked = new Set();
        this.stop();
    }

    stop() {
        // A held key must be released before it can restart movement after a stop.
        for (const key of this.held) this.blocked.add(key);
        this.held.clear();
        this.linear = this.angular = 0;
        this.locked = false;
        this.lastTick = null;
        this.axes = { linear: { direction: 0, since: 0 }, angular: { direction: 0, since: 0 } };
        return this.snapshot();
    }

    snapshot() {
        return { linear: this.linear, angular: this.angular, locked: this.locked, keys: [...this.held] };
    }

    keyDown(key, now, { repeat = false } = {}) {
        key = key.toLowerCase();
        if (repeat || this.held.has(key) || this.blocked.has(key)) return false;
        const wasLocked = this.locked;
        if (wasLocked) this.stop();
        if ([' ', 'x', 'escape'].includes(key)) { this.stop(); return true; }
        if (key === 'l') {
            if (!wasLocked && (this.linear !== 0 || this.angular !== 0)) {
                this.locked = true;
                for (const held of this.held) this.blocked.add(held);
                this.held.clear();
                this.lastTick = now;
            }
            return true;
        }
        if (!(key in AXES)) return wasLocked;
        if (this.singleDirection) {
            for (const held of this.held) this.blocked.add(held);
            this.held.clear();
        }
        this.held.add(key);
        this.syncAxes(now);
        this.lastTick = now;
        return true;
    }

    keyUp(key, now) {
        key = key.toLowerCase();
        this.blocked.delete(key);
        if (!this.held.delete(key)) return false;
        this.syncAxes(now);
        return true;
    }

    syncAxes(now) {
        for (const [axis, positive, negative] of [['linear', 'w', 's'], ['angular', 'a', 'd']]) {
            const direction = Number(this.held.has(positive)) - Number(this.held.has(negative));
            if (direction !== this.axes[axis].direction) {
                this.axes[axis] = { direction, since: now };
                this[axis] = 0;
            }
        }
    }

    tick(now) {
        if (this.lastTick === null) { this.lastTick = now; return this.snapshot(); }
        const elapsed = now - this.lastTick;
        // Never resume cruise or jump velocity after a suspended/throttled event loop.
        if (elapsed > 250 || elapsed < 0) return this.stop();
        this.lastTick = now;
        if (!this.locked) {
            for (const axis of ['linear', 'angular']) {
                const { direction, since } = this.axes[axis];
                if (!direction) continue;
                const heldSeconds = Math.max(0, (now - since - elapsed / 2) / 1000);
                const acceleration = Math.min(1, 0.15 + 0.35 * heldSeconds);
                this[axis] = Math.max(-1, Math.min(1, this[axis] + direction * acceleration * elapsed / 1000));
            }
        }
        return this.snapshot();
    }
}

export function isTypingTarget(target) {
    return !!target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
}
