export type WebRtcMetrics = {
    fps: number;
    bitrateBps: number;
    lossRatio: number;
    jitterMs: number;
    decodeMs: number;
    targetFps: number;
    scale: number;
    adaptiveQuality: boolean;
};

/** Interval deltas avoid cumulative-loss bias and survive peer/stat resets. */
export class WebRtcStatsSampler {
    private previous: any = null;

    sample(report: RTCStatsReport): Omit<WebRtcMetrics, 'targetFps' | 'scale' | 'adaptiveQuality'> | null {
        let current: any = null;
        report.forEach(stat => {
            if (stat.type === 'inbound-rtp' && (stat.kind === 'video' || stat.mediaType === 'video')) current = stat;
        });
        if (!current) return null;
        const old = this.previous;
        this.previous = current;
        if (!old || old.id !== current.id) return null;
        const seconds = (current.timestamp - old.timestamp) / 1000;
        const frames = (current.framesDecoded ?? current.framesReceived ?? 0) - (old.framesDecoded ?? old.framesReceived ?? 0);
        const bytes = current.bytesReceived - old.bytesReceived;
        const packets = current.packetsReceived - old.packetsReceived;
        if (seconds <= 0 || frames < 0 || bytes < 0 || packets < 0 || !Number.isFinite(bytes) || !Number.isFinite(packets)) return null;
        const lost = Math.max(0, (current.packetsLost ?? 0) - (old.packetsLost ?? 0));
        const decode = Math.max(0, (current.totalDecodeTime ?? 0) - (old.totalDecodeTime ?? 0));
        return {
            fps: frames / seconds,
            bitrateBps: bytes * 8 / seconds,
            lossRatio: packets + lost > 0 ? lost / (packets + lost) : 0,
            jitterMs: (current.jitter ?? 0) * 1000,
            decodeMs: frames > 0 ? decode * 1000 / frames : 0,
        };
    }
}
