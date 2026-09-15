import { WebRtcStatsSampler, type WebRtcMetrics } from './webRtcMetrics.ts';
export type { WebRtcMetrics } from './webRtcMetrics.ts';
export const WEBRTC_TARGET_FPS = 24;

type WebRtcState = 'disconnected' | 'connecting' | 'connected' | 'error';
type StreamError = Error & { status?: number };
type Session = {
	pc: RTCPeerConnection;
	video: HTMLVideoElement;
	controller: AbortController;
	stream: MediaStream | null;
	deleteUrl: string | null;
	established: boolean;
	metricsTimer?: ReturnType<typeof setTimeout>;
	feedbackUrl?: string;
	targetFps: number;
	scale: number;
};

function errorMessage(status: number): string {
	switch (status) {
		case 400: return 'Camera not started — click Start first';
		case 404: return 'Camera not found';
		case 429: return 'Too many viewers — try MJPEG mode';
		case 503: return 'ROS not connected';
		default: return `WebRTC negotiation failed (HTTP ${status})`;
	}
}

// Bound native WebRTC promises as well as fetch. Cancellation must not wait
// for ICE gathering or a pending SDP operation to finish.
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	return new Promise((resolve, reject) => {
		const abort = () => reject(signal.reason);
		if (signal.aborted) abort();
		else signal.addEventListener('abort', abort, { once: true });
		promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
	});
}

function waitForPeer(pc: RTCPeerConnection, event: string, ready: () => boolean, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			pc.removeEventListener(event, check);
			signal.removeEventListener('abort', abort);
		};
		const abort = () => { cleanup(); reject(signal.reason); };
		const check = () => {
			if (signal.aborted) abort();
			else if (ready()) { cleanup(); resolve(); }
		};
		pc.addEventListener(event, check);
		signal.addEventListener('abort', abort, { once: true });
		check();
	});
}

export class WebRtcStreamClient {
	private session: Session | null = null;
	private state: WebRtcState = 'disconnected';
	private timeoutMs: number;
	private onStateChangeCallback: ((state: WebRtcState) => void) | null = null;
	private onErrorCallback: ((err: StreamError) => void) | null = null;
	private onMetricsCallback: ((metrics: WebRtcMetrics) => void) | null = null;

	constructor(timeoutMs = 20000) { this.timeoutMs = timeoutMs; }
	onStateChange(cb: (state: WebRtcState) => void): void { this.onStateChangeCallback = cb; }
	onError(cb: (err: StreamError) => void): void { this.onErrorCallback = cb; }
	onMetrics(cb: (metrics: WebRtcMetrics) => void): void { this.onMetricsCallback = cb; }
	getState(): WebRtcState { return this.state; }

	private setState(state: WebRtcState): void {
		if (this.state === state) return;
		this.state = state;
		this.onStateChangeCallback?.(state);
	}

	private async release(session: Session): Promise<void> {
		if (session.metricsTimer) clearTimeout(session.metricsTimer);
		session.pc.ontrack = null;
		session.pc.onconnectionstatechange = null;
		session.pc.close();
		if (session.stream && session.video.srcObject === session.stream) session.video.srcObject = null;
		const deleteUrl = session.deleteUrl;
		session.deleteUrl = null;
		// Old servers do not return a peer ID. Closing the local peer lets ICE
		// clean it up there; NEVER fall back to the legacy close-all endpoint.
		if (!deleteUrl) return;
		try {
			const response = await fetch(deleteUrl, { method: 'DELETE', signal: AbortSignal.timeout(5000) });
			if (!response.ok) console.warn(`[WebRTC] Peer cleanup returned HTTP ${response.status}`);
		} catch (error) { console.warn('[WebRTC] Peer cleanup failed:', error); }
	}

	/** Receive video; resolve only when ICE/DTLS actually connects. */
	async connect(offerUrl: string, video: HTMLVideoElement, fps = WEBRTC_TARGET_FPS): Promise<void> {
		if (this.session) return;
		this.setState('connecting');
		const controller = new AbortController();
		const signal = controller.signal;
		const timer = setTimeout(() => controller.abort(new DOMException('WebRTC connection timed out', 'TimeoutError')), this.timeoutMs);
		let session: Session | null = null;
		try {
			const pc = new RTCPeerConnection({ iceServers: [] });
			session = { pc, video, controller, stream: null, deleteUrl: null, established: false, targetFps: fps, scale: 1 };
			this.session = session;
			const current = session;
			pc.ontrack = (event) => {
				if (this.session !== current || signal.aborted) return;
				current.stream = event.streams?.[0] ?? new MediaStream([event.track]);
				video.srcObject = current.stream;
			};
			pc.onconnectionstatechange = () => {
				if (this.session !== current) return;
				if (pc.connectionState === 'connected') this.setState('connected');
				else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
					const error = new Error(`WebRTC transport ${pc.connectionState}`);
					controller.abort(error);
					if (current.established) {
						this.session = null;
						this.setState('error');
						void this.release(current);
						this.onErrorCallback?.(error);
					}
				} else if (pc.connectionState === 'disconnected') this.setState('disconnected');
			};

			pc.addTransceiver('video', { direction: 'recvonly' });
			const offer = await abortable(pc.createOffer(), signal);
			signal.throwIfAborted();
			await abortable(pc.setLocalDescription(offer), signal);
			await waitForPeer(pc, 'icegatheringstatechange', () => pc.iceGatheringState === 'complete', signal);
			signal.throwIfAborted();
			const response = await abortable(fetch(offerUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ sdp: pc.localDescription!.sdp, type: pc.localDescription!.type, fps }),
				signal,
			}), signal);
			const answer = await abortable(response.json().catch(() => ({})), signal);
			if (!response.ok) throw Object.assign(new Error(answer.detail ?? errorMessage(response.status)), { status: response.status });
			if (typeof answer.peer_id === 'string' && answer.peer_id) {
				const url = new URL(offerUrl);
				url.pathname = url.pathname.replace(/\/offer\/?$/, '') + '/connections/' + encodeURIComponent(answer.peer_id);
				if (typeof answer.topic === 'string') url.searchParams.set('topic_name', answer.topic);
				current.deleteUrl = url.toString();
				if (answer.adaptive_quality === true) {
					url.pathname += '/feedback';
					current.feedbackUrl = url.toString();
				}
			}
			if (Number.isFinite(answer.target_fps) && answer.target_fps > 0) current.targetFps = answer.target_fps;
			signal.throwIfAborted();
			await abortable(pc.setRemoteDescription({ type: answer.type, sdp: answer.sdp }), signal);
			await waitForPeer(pc, 'connectionstatechange', () => pc.connectionState === 'connected', signal);
			signal.throwIfAborted();
			current.established = true;
			this.setState('connected');
			this.startMetrics(current);
		} catch (reason) {
			const error = reason instanceof Error ? reason : new Error(String(reason));
			if (session) void this.release(session);
			// An intentional disconnect or replacement owns the current state.
			if (!session || this.session === session) {
				this.session = null;
				this.setState('error');
				this.onErrorCallback?.(error);
			}
			throw error;
		} finally { clearTimeout(timer); }
	}

	private startMetrics(session: Session): void {
		if (typeof session.pc.getStats !== 'function') return;
		const sampler = new WebRtcStatsSampler();
		const poll = async () => {
			if (this.session !== session || session.controller.signal.aborted) return;
			try {
				const stats = await abortable(session.pc.getStats(), session.controller.signal);
				if (this.session !== session) return;
				const metrics = sampler.sample(stats);
				if (metrics) {
					// Hidden tabs can throttle decoding; do not downgrade the stream for that.
					if (session.feedbackUrl && session.pc.connectionState === 'connected' && (typeof document === 'undefined' || !document.hidden)) {
						const response = await fetch(session.feedbackUrl, {
							method: 'POST', headers: { 'Content-Type': 'application/json' },
							signal: AbortSignal.any([session.controller.signal, AbortSignal.timeout(3000)]),
							body: JSON.stringify({ received_fps: metrics.fps, loss_ratio: metrics.lossRatio, jitter_ms: metrics.jitterMs, decode_ms: metrics.decodeMs }),
						});
						if (response.ok) {
							const profile = await response.json();
							if (Number.isFinite(profile.scale) && profile.scale >= 0.5 && profile.scale <= 1) session.scale = profile.scale;
						} else if (response.status === 404 || response.status === 405) session.feedbackUrl = undefined;
					}
					if (this.session === session) this.onMetricsCallback?.({ ...metrics, targetFps: session.targetFps, scale: session.scale, adaptiveQuality: !!session.feedbackUrl });
				}
			} catch (error) {
				if (!session.controller.signal.aborted) console.debug('[WebRTC] Metrics sample unavailable:', error);
			} finally {
				if (this.session === session && !session.controller.signal.aborted) session.metricsTimer = setTimeout(poll, 2000);
			}
		};
		void poll();
	}

	/** Keep the old argument for callers; cleanup uses the original peer's URL. */
	async disconnect(_legacyDeleteUrl?: string): Promise<void> {
		const session = this.session;
		this.session = null;
		this.setState('disconnected');
		if (!session) return;
		session.controller.abort(new DOMException('WebRTC connection cancelled', 'AbortError'));
		await this.release(session);
	}
}
