/** One command in flight; coalesce movement, but never skip a requested stop. */
export class DriveCommandQueue {
    constructor(send, onError) { this.send = send; this.onError = onError; this.pending = null; this.stopPending = null; this.running = null; }

    submit(command) {
        if (command.linear === 0 && command.angular === 0) {
            this.stopPending = command;
            this.pending = null;
        } else this.pending = command;
        if (!this.running) this.start();
        return this.running;
    }

    start() {
        // Defer startup so the running promise is assigned even for synchronous failures.
        this.running = Promise.resolve().then(() => this.pump()).finally(() => {
            this.running = null;
            if (this.stopPending || this.pending) this.start();
        });
    }

    async pump() {
        while (this.stopPending || this.pending) {
            const command = this.stopPending ?? this.pending;
            if (this.stopPending) this.stopPending = null;
            else this.pending = null;
            try { await this.send(command); }
            catch (error) {
                this.pending = this.stopPending = null;
                this.onError(error, command);
                return;
            }
        }
    }
}
