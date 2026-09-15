/**
 * WebSocket Video Streaming Service
 * 
 * Provides low-latency video streaming from rover cameras using WebSocket binary frames.
 * Handles connection management, frame decoding, canvas rendering, and performance metrics.
 */

import { JpegQualityController } from './jpegQualityController.js';

// Protocol constants (must match backend)
const MAGIC_NUMBER = 0x524F5652; // "ROVR" in ASCII
const HEADER_SIZE = 24;

export interface FrameHeader {
	magic: number;
	cameraIndex: number;
	timestampUs: bigint;
	frameNumber: number;
	quality: number;
}

export interface DecodedFrame {
	header: FrameHeader;
	jpegData: Blob;
	latencyMs: number;
}

export interface StreamMetrics {
	bitrateBps?: number;
	quality?: number;
	targetFps?: number;
	fps: number;
	avgLatencyMs: number;
	minLatencyMs: number;
	maxLatencyMs: number;
	framesReceived: number;
	bytesReceived: number;
	errors: number;
	connected: boolean;
}

export interface StreamConfig {
	adaptiveQuality?: boolean;
	quality?: number; // 1-100
	fps?: number; // 1-60
	autoReconnect?: boolean;
	reconnectDelay?: number; // milliseconds
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Decodes binary frame from WebSocket message
 */
export function decodeFrame(arrayBuffer: ArrayBuffer): DecodedFrame {
	if (arrayBuffer.byteLength < HEADER_SIZE) {
		throw new Error(`Frame too small: ${arrayBuffer.byteLength} bytes`);
	}

	const view = new DataView(arrayBuffer);

	// Parse header (little-endian)
	const header: FrameHeader = {
		magic: view.getUint32(0, true),
		cameraIndex: view.getInt32(4, true),
		timestampUs: view.getBigInt64(8, true),
		frameNumber: view.getUint32(16, true),
		quality: view.getUint8(20)
	};

	// Validate magic number
	if (header.magic !== MAGIC_NUMBER) {
		throw new Error(`Invalid magic number: ${header.magic.toString(16)}`);
	}

	// Extract JPEG data
	const jpegData = new Blob([arrayBuffer.slice(HEADER_SIZE)], { type: 'image/jpeg' });

	// Calculate latency
	const nowUs = BigInt(Math.floor(Date.now() * 1000));
	const latencyMs = Number(nowUs - header.timestampUs) / 1000;

	return { header, jpegData, latencyMs };
}

/**
 * WebSocket Video Stream Client
 */
export class VideoStreamClient {
	private ws: WebSocket | null = null;
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private config: Required<StreamConfig>;
	private state: ConnectionState = 'disconnected';
	private cameraName: string | null = null;
	private intentionalDisconnect: boolean = false;

	// Metrics tracking
	private metrics: StreamMetrics = {
		fps: 0,
		avgLatencyMs: 0,
		minLatencyMs: Infinity,
		maxLatencyMs: 0,
		framesReceived: 0,
		bytesReceived: 0,
		errors: 0,
		connected: false
	};

	private latencyHistory: number[] = [];
	private frameTimestamps: number[] = [];
	private metricsInterval: number | null = null;
	private reconnectTimeout: number | null = null;
	private qualityController = new JpegQualityController();
	private supportsQualityControl = false;
	private lastMetricTime = 0;
	private lastMetricFrames = 0;
	private lastMetricBytes = 0;

	// Callbacks
	private onFrameCallback: ((frame: DecodedFrame) => void) | null = null;
	private onMetricsCallback: ((metrics: StreamMetrics) => void) | null = null;
	private onStateChangeCallback: ((state: ConnectionState) => void) | null = null;
	private onErrorCallback: ((error: Error) => void) | null = null;

	constructor(config: StreamConfig = {}) {
		this.config = {
			adaptiveQuality: config.adaptiveQuality ?? true,
			quality: config.quality ?? 85,
			fps: config.fps ?? 30,
			autoReconnect: config.autoReconnect ?? true,
			reconnectDelay: config.reconnectDelay ?? 2000
		};
		this.qualityController = new JpegQualityController(this.config.quality);
	}

	/**
	 * Connect to WebSocket video stream
	 */
	async connect(cameraName: string, canvas?: HTMLCanvasElement): Promise<void> {
		if (this.state === 'connected' || this.state === 'connecting') {
			console.warn('Already connected or connecting');
			return;
		}

		// Reset intentional disconnect flag
		this.intentionalDisconnect = false;

		// Store canvas reference
		if (canvas) {
			this.canvas = canvas;
			this.ctx = canvas.getContext('2d', { alpha: false });
		}

		this.setState('connecting');
		this.cameraName = cameraName;

		// Build WebSocket URL from API base URL
		// Import dynamically to avoid circular dependency
		const { getApiBaseUrl } = await import('$lib/services/roverApi');
		const baseUrl = getApiBaseUrl();
		const wsUrl = baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
		const url = `${wsUrl}/api/nav/cameras/${cameraName}/ws?quality=${this.config.quality}&fps=${this.config.fps}`;

		try {
			this.ws = new WebSocket(url);
			this.ws.binaryType = 'arraybuffer';

			// Setup event handlers
			this.ws.onopen = () => this.handleOpen();
			this.ws.onmessage = (event) => this.handleMessage(event);
			this.ws.onerror = (event) => this.handleError(event);
			this.ws.onclose = (event) => this.handleClose(event);
		} catch (error) {
			this.setState('error');
			const err = error instanceof Error ? error : new Error(String(error));
			this.onErrorCallback?.(err);
			throw err;
		}
	}

	/**
	 * Connect to custom WebSocket URL (for microscope or other devices)
	 */
	async connectCustom(wsUrl: string, canvas?: HTMLCanvasElement): Promise<void> {
		if (this.state === 'connected' || this.state === 'connecting') {
			console.warn('Already connected or connecting');
			return;
		}

		// Reset intentional disconnect flag
		this.intentionalDisconnect = false;

		// Store canvas reference
		if (canvas) {
			this.canvas = canvas;
			this.ctx = canvas.getContext('2d', { alpha: false });
		}

		this.setState('connecting');

		try {
			this.ws = new WebSocket(wsUrl);
			this.ws.binaryType = 'arraybuffer';

			// Setup event handlers
			this.ws.onopen = () => this.handleOpen();
			this.ws.onmessage = (event) => this.handleMessage(event);
			this.ws.onerror = (event) => this.handleError(event);
			this.ws.onclose = (event) => this.handleClose(event);
		} catch (error) {
			this.setState('error');
			const err = error instanceof Error ? error : new Error(String(error));
			this.onErrorCallback?.(err);
			throw err;
		}
	}

	/**
	 * Disconnect from WebSocket stream
	 */
	disconnect(): void {
		// Mark as intentional so we don't show errors or auto-reconnect
		this.intentionalDisconnect = true;

		if (this.reconnectTimeout) {
			clearTimeout(this.reconnectTimeout);
			this.reconnectTimeout = null;
		}

		if (this.metricsInterval) {
			clearInterval(this.metricsInterval);
			this.metricsInterval = null;
		}

		if (this.ws) {
			// Close with normal closure code
			this.ws.close(1000, 'User requested disconnect');
			this.ws = null;
		}

		this.setState('disconnected');
		this.metrics.connected = false;
		this.onMetricsCallback?.({ ...this.metrics });
	}

	/**
	 * Send control message to server
	 */
	sendControl(type: string, params?: Record<string, any>): void {
		if (!this.ws || this.state !== 'connected') {
			console.warn('Not connected, cannot send control message');
			return;
		}

		const message = params ? { type, ...params } : { type };
		this.ws.send(JSON.stringify(message));
	}

	/**
	 * Set quality dynamically
	 */
	setQuality(quality: number): void {
		this.config.quality = Math.max(1, Math.min(100, quality));
		this.sendControl('control', {
			action: 'set_quality',
			params: { quality: this.config.quality }
		});
	}

	/**
	 * Send ping to server
	 */
	ping(): void {
		this.sendControl('ping');
	}

	/**
	 * Get current metrics
	 */
	getMetrics(): StreamMetrics {
		return { ...this.metrics };
	}

	/**
	 * Get connection state
	 */
	getState(): ConnectionState {
		return this.state;
	}

	/**
	 * Register callback for frame reception
	 */
	onFrame(callback: (frame: DecodedFrame) => void): void {
		this.onFrameCallback = callback;
	}

	/**
	 * Register callback for metrics updates
	 */
	onMetrics(callback: (metrics: StreamMetrics) => void): void {
		this.onMetricsCallback = callback;
	}

	/**
	 * Register callback for state changes
	 */
	onStateChange(callback: (state: ConnectionState) => void): void {
		this.onStateChangeCallback = callback;
	}

	/**
	 * Register callback for errors
	 */
	onError(callback: (error: Error) => void): void {
		this.onErrorCallback = callback;
	}

	// Private methods

	private setState(state: ConnectionState): void {
		this.state = state;
		this.onStateChangeCallback?.(state);
	}

	private handleOpen(): void {
		this.lastMetricTime = Date.now();
		this.lastMetricFrames = this.metrics.framesReceived;
		this.lastMetricBytes = this.metrics.bytesReceived;
		this.supportsQualityControl = false;
		this.qualityController = new JpegQualityController(this.config.quality);
		console.log('[VideoStream] Connected');
		this.setState('connected');
		this.metrics.connected = true;
		this.metrics.errors = 0;

		// Start metrics calculation
		this.startMetricsUpdates();
	}

	private handleMessage(event: MessageEvent): void {
		if (typeof event.data === 'string') {
			// JSON message (status, control response)
			try {
				const data = JSON.parse(event.data);
				console.log('[VideoStream] Received:', data);

				// Handle initial status
				if (data.type === 'status') {
					console.log(`[VideoStream] Camera ${data.camera_index} ready: ${data.resolution} @ ${data.fps}fps`);
				}
			} catch (error) {
				console.error('[VideoStream] JSON parse error:', error);
			}
		} else if (event.data instanceof ArrayBuffer) {
			// Binary frame
			this.handleFrame(event.data);
		}
	}

	private handleFrame(arrayBuffer: ArrayBuffer): void {
		try {
			// Check if this is a simple JPEG (microscope) or complex header format (camera)
			let jpegBlob: Blob;
			let latencyMs = 0;
			
			// Try to decode as complex format first
			if (arrayBuffer.byteLength >= HEADER_SIZE) {
				const view = new DataView(arrayBuffer);
				const magic = view.getUint32(0, true);
				
				if (magic === MAGIC_NUMBER) {
					this.supportsQualityControl = true;
					// Complex format with header
					const frame = decodeFrame(arrayBuffer);
					jpegBlob = frame.jpegData;
					latencyMs = frame.latencyMs;
					
					// Call frame callback if registered
					this.onFrameCallback?.(frame);
				} else {
					// Simple JPEG format (microscope)
					jpegBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });
				}
			} else {
				// Too small for header, must be simple JPEG
				jpegBlob = new Blob([arrayBuffer], { type: 'image/jpeg' });
			}

			// Update metrics
			this.metrics.framesReceived++;
			this.metrics.bytesReceived += arrayBuffer.byteLength;

			// Track latency (only for complex format)
			if (latencyMs > 0) {
				this.latencyHistory.push(latencyMs);
				if (this.latencyHistory.length > 100) {
					this.latencyHistory.shift();
				}
			}

			// Track frame timestamps for FPS calculation
			this.frameTimestamps.push(Date.now());
			if (this.frameTimestamps.length > 60) {
				this.frameTimestamps.shift();
			}

			// Render to canvas if available
			if (this.canvas && this.ctx) {
				this.renderFrameToCanvas(jpegBlob);
			}
		} catch (error) {
			console.error('[VideoStream] Frame decode error:', error);
			this.metrics.errors++;
			const err = error instanceof Error ? error : new Error(String(error));
			this.onErrorCallback?.(err);
		}
	}

	private renderFrameToCanvas(jpegBlob: Blob): void {
		if (!this.canvas || !this.ctx) return;

		// Create image from blob
		const img = new Image();
		const url = URL.createObjectURL(jpegBlob);

		img.onload = () => {
			if (!this.canvas || !this.ctx) {
				URL.revokeObjectURL(url);
				return;
			}

			// Draw image to canvas (maintain aspect ratio)
			const canvasAspect = this.canvas.width / this.canvas.height;
			const imageAspect = img.width / img.height;

			let drawWidth = this.canvas.width;
			let drawHeight = this.canvas.height;
			let drawX = 0;
			let drawY = 0;

			if (imageAspect > canvasAspect) {
				// Image is wider - fit to width
				drawHeight = this.canvas.width / imageAspect;
				drawY = (this.canvas.height - drawHeight) / 2;
			} else {
				// Image is taller - fit to height
				drawWidth = this.canvas.height * imageAspect;
				drawX = (this.canvas.width - drawWidth) / 2;
			}

			// Clear canvas
			this.ctx.fillStyle = '#000000';
			this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

			// Draw image
			this.ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

			URL.revokeObjectURL(url);
		};

		img.onerror = () => {
			console.error('[VideoStream] Failed to load image from blob');
			URL.revokeObjectURL(url);
			this.metrics.errors++;
		};

		img.src = url;
	}

	private handleError(event: Event): void {
		// Ignore errors if we intentionally disconnected
		if (this.intentionalDisconnect) {
			console.log('[VideoStream] Ignoring error during intentional disconnect');
			return;
		}

		console.error('[VideoStream] WebSocket error:', event);
		this.setState('error');
		this.metrics.errors++;
		this.onErrorCallback?.(new Error('WebSocket error'));
	}

	private handleClose(event: CloseEvent): void {
		console.log(`[VideoStream] Disconnected: ${event.code} ${event.reason}`);
		this.setState('disconnected');
		this.metrics.connected = false;

		if (this.metricsInterval) {
			clearInterval(this.metricsInterval);
			this.metricsInterval = null;
		}

		// Only auto-reconnect if not intentionally disconnected
		if (!this.intentionalDisconnect && this.config.autoReconnect && event.code !== 1000 && this.cameraName !== null) {
			console.log(`[VideoStream] Reconnecting in ${this.config.reconnectDelay}ms...`);
			this.reconnectTimeout = window.setTimeout(() => {
				if (this.cameraName !== null) {
					console.log(`[VideoStream] Attempting to reconnect to camera '${this.cameraName}'...`);
					this.connect(this.cameraName, this.canvas || undefined).catch((err) => {
						console.error('[VideoStream] Reconnection failed:', err);
						this.onErrorCallback?.(err);
					});
				}
			}, this.config.reconnectDelay);
		}

		this.onMetricsCallback?.({ ...this.metrics });
	}

	private startMetricsUpdates(): void {
		// Update metrics every second
		this.metricsInterval = window.setInterval(() => {
			this.updateMetrics();
			this.onMetricsCallback?.({ ...this.metrics });
		}, 1000);
	}

	private updateMetrics(): void {
		const now = Date.now();
		const elapsed = (now - this.lastMetricTime) / 1000;
		if (elapsed > 0) {
			this.metrics.fps = (this.metrics.framesReceived - this.lastMetricFrames) / elapsed;
			this.metrics.bitrateBps = (this.metrics.bytesReceived - this.lastMetricBytes) * 8 / elapsed;
			this.lastMetricTime = now;
			this.lastMetricFrames = this.metrics.framesReceived;
			this.lastMetricBytes = this.metrics.bytesReceived;
			if (this.config.adaptiveQuality && this.supportsQualityControl && (typeof document === 'undefined' || !document.hidden)) {
				const quality = this.qualityController.update(this.metrics.fps, this.config.fps);
				if (quality !== this.config.quality) this.setQuality(quality);
			}
		}
		this.metrics.quality = this.config.quality;
		this.metrics.targetFps = this.config.fps;

		// Calculate latency statistics
		if (this.latencyHistory.length > 0) {
			const sum = this.latencyHistory.reduce((a, b) => a + b, 0);
			this.metrics.avgLatencyMs = sum / this.latencyHistory.length;
			this.metrics.minLatencyMs = Math.min(...this.latencyHistory);
			this.metrics.maxLatencyMs = Math.max(...this.latencyHistory);
		}
	}
}

/**
 * Singleton manager for multiple camera streams
 */
export class VideoStreamManager {
	private streams = new Map<number, VideoStreamClient>();

	/**
	 * Get or create stream for camera
	 */
	getStream(cameraIndex: number, config?: StreamConfig): VideoStreamClient {
		if (!this.streams.has(cameraIndex)) {
			this.streams.set(cameraIndex, new VideoStreamClient(config));
		}
		return this.streams.get(cameraIndex)!;
	}

	/**
	 * Disconnect and remove stream
	 */
	removeStream(cameraIndex: number): void {
		const stream = this.streams.get(cameraIndex);
		if (stream) {
			stream.disconnect();
			this.streams.delete(cameraIndex);
		}
	}

	/**
	 * Disconnect all streams
	 */
	disconnectAll(): void {
		this.streams.forEach((stream) => stream.disconnect());
		this.streams.clear();
	}

	/**
	 * Get all active streams
	 */
	getAllStreams(): Map<number, VideoStreamClient> {
		return new Map(this.streams);
	}
}

// Export singleton instance
export const videoStreamManager = new VideoStreamManager();

// ─────────────────────────────────────────────────────────────────────────────
// WebRTC Streaming Client
// ─────────────────────────────────────────────────────────────────────────────

export { WebRtcStreamClient, WEBRTC_TARGET_FPS } from './webRtcStreamClient.ts';
