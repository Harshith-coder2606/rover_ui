<script lang="ts">
	import { Camera, Power, PowerOff, Image as ImageIcon, RefreshCw, AlertCircle, Wifi, WifiOff, Activity, Radio } from '@lucide/svelte';
	import { apiStatus } from '$lib/stores/apiStore';
	import { expeditionStore, currentExpeditionId, isExpeditionActive } from '$lib/stores/expeditionStore';
	import * as roverApi from '$lib/services/roverApi';
	import { VideoStreamClient, WebRtcStreamClient, type StreamMetrics } from '$lib/services/videoStreamService';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { onMount, untrack } from 'svelte';
	import { selectCameraMode } from '$lib/services/cameraStreamProfile.js';
	import { WEBRTC_TARGET_FPS, type WebRtcMetrics } from '$lib/services/webRtcStreamClient';
	import { OpticalFlowService } from '$lib/services/opticalFlowService';
	
	// Camera state - Svelte 5 runes
	let cameras = $state<any[]>([]);
	let cameraFormats = $state<Map<string, any[]>>(new Map());
	let cameraFps = $state<Map<string, number>>(new Map());
	let rtcMetrics = $state<Map<string, WebRtcMetrics>>(new Map());
	let webrtcStates = $state<Map<string, string>>(new Map());
	let activeCameras = $state<Set<string>>(new Set());
	let loading = $state(false);
	let error = $state<string | null>(null);
	let feedbackMessage = $state('');
	let feedbackType = $state<'success' | 'error'>('success');
	let showFeedback = $state(false);
	
	// Streaming mode per camera: 'mjpeg' | 'websocket' | 'webrtc'
	let streamingModes = $state<Map<string, 'mjpeg' | 'websocket' | 'webrtc'>>(new Map());
	
	// WebSocket clients per camera
	let wsClients = $state<Map<string, VideoStreamClient>>(new Map());
	
	// WebRTC clients per camera
	let webrtcClients = $state<Map<string, WebRtcStreamClient>>(new Map());
	
	// WebRTC connection status per camera {active_connections, max_connections}
	let webrtcStatuses = $state<Map<string, { active_connections: number; max_connections: number }>>(new Map());
	
	// Polling intervals for WebRTC status
	let webrtcStatusIntervals = new Map<string, ReturnType<typeof setInterval>>();
	
	// Retry timers for 500 errors
	let webrtcRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();
	let webrtcRetryCounts = new Map<string, number>();
	
	// MJPEG fps/quality per camera
	let mjpegParams = $state<Map<string, { fps: number; quality: number }>>(new Map());
	// Debounce timers for MJPEG param changes
	let mjpegDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
	
	// Stream metrics per camera
	let streamMetrics = $state<Map<string, StreamMetrics>>(new Map());
	
	// Canvas refs per camera (WebSocket)
	let canvasRefs: Record<string, HTMLCanvasElement | undefined> = $state({});
	// Video refs per camera (WebRTC)
	let videoRefs: Record<string, HTMLVideoElement | undefined> = $state({});
	// Optical flow diagnostics for RGB WebRTC cameras
	const opticalFlowService = new OpticalFlowService();
	let opticalFlowReady = $state(false);
	// Resolution state per camera
	let supportedResolutions = $state<Map<string, Array<{width: number, height: number}>>>(new Map());
	let selectedResolutions = $state<Map<string, {width: number, height: number}>>(new Map());
	
	// Telemetry for captures
	let telemetry = $state({
		latitude: 16.5062,
		longitude: 80.6480,
		altitude: 0,
		battery_level: 85,
		mission_id: 'default',
		rover_id: 'rover_001'
	});
	
	// Show feedback messages
	function showFeedbackMsg(message: string, type: 'success' | 'error' = 'success') {
		feedbackMessage = message;
		feedbackType = type;
		showFeedback = true;
		
		setTimeout(() => {
			showFeedback = false;
		}, 5000);
	}
	
	// Detect cameras on mount
	async function detectCameras() {
		loading = true;
		error = null;
		
		try {
			const result = await roverApi.detectCameras();
			cameras = result.cameras || [];
			showFeedbackMsg(`Found ${cameras.length} camera(s)`, 'success');
			
			// Initialize streaming mode for each camera (default to WebRTC)
			cameras.forEach(cam => {
				if (!streamingModes.has(cam.name)) {
					streamingModes.set(cam.name, 'webrtc');
				}
				if (!mjpegParams.has(cam.name)) {
					mjpegParams.set(cam.name, { fps: 30, quality: 80 });
				}
			});
			streamingModes = new Map(streamingModes);
			mjpegParams = new Map(mjpegParams);
			
			// Fetch supported resolutions for each camera
			await fetchAllResolutions();
		} catch (err: any) {
			error = err.message;
			showFeedbackMsg(`Failed to detect cameras: ${err.message}`, 'error');
			cameras = [];
		} finally {
			loading = false;
		}
	}
	
	// Fetch supported resolutions for all detected cameras
	async function fetchAllResolutions() {
		await Promise.all(cameras.map(async (camera) => {
			try {
				const result = await roverApi.getSupportedResolutions(camera.name);
				cameraFormats.set(camera.name, result.formats || []);
				if (result.formats?.length > 0) {
					// Flatten resolutions from all formats, removing duplicates
					const allResolutions = result.formats
						.flatMap((f: any) => f.resolutions)
						.filter((r: any, i: number, arr: any[]) => 
							arr.findIndex(x => x.width === r.width && x.height === r.height) === i
						);
					
					// Sort by resolution (largest first)
					allResolutions.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height));
					
					supportedResolutions.set(camera.name, allResolutions);
					
					// Set default resolution (720p if available, otherwise first one)
					const default720p = allResolutions.find((r: any) => r.width === 1280 && r.height === 720);
					const defaultRes = default720p || allResolutions[0] || { width: 1280, height: 720 };
					selectedResolutions.set(camera.name, defaultRes);
				}
			} catch (e) {
				console.warn(`Failed to get resolutions for ${camera.name}:`, e);
				// Set fallback resolutions
				const fallback = [
					{ width: 1920, height: 1080 },
					{ width: 1280, height: 720 },
					{ width: 640, height: 480 },
					{ width: 320, height: 240 }
				];
				supportedResolutions.set(camera.name, fallback);
				selectedResolutions.set(camera.name, { width: 1280, height: 720 });
			}
		}));
		
		// Trigger reactivity
		supportedResolutions = new Map(supportedResolutions);
		cameraFormats = new Map(cameraFormats);
		selectedResolutions = new Map(selectedResolutions);
	}
	
	function cameraMode(cameraName: string) {
		const size = selectedResolutions.get(cameraName) || { width: 1280, height: 720 };
		const camera = cameras.find(cam => cam.name === cameraName);
		return selectCameraMode(cameraFormats.get(cameraName), size.width, size.height, camera?.default_fps);
	}

	function targetFps(cameraName: string) {
		if (streamingModes.get(cameraName) === 'webrtc') return WEBRTC_TARGET_FPS;
		return (activeCameras.has(cameraName) ? cameraFps.get(cameraName) : undefined) ?? cameraMode(cameraName).fps;
	}

	// Start a camera
	async function startCamera(cameraName: string) {
		try {
			// Get selected resolution, or use default
			const resolution = selectedResolutions.get(cameraName) || { width: 1280, height: 720 };
			const profile = cameraMode(cameraName);
			const result = await roverApi.startCamera(cameraName, resolution.width, resolution.height, profile.fps, profile.pixelFormat);
			const actualFps = result.camera?.fps;
			cameraFps.set(cameraName, Number.isFinite(actualFps) && actualFps > 0 ? Math.min(profile.fps, actualFps) : profile.fps);
			cameraFps = new Map(cameraFps);
			mjpegParams.set(cameraName, { fps: Math.round(cameraFps.get(cameraName) ?? profile.fps), quality: mjpegParams.get(cameraName)?.quality ?? 80 });
			mjpegParams = new Map(mjpegParams);
			activeCameras.add(cameraName);
			activeCameras = new Set(activeCameras);
			
			// Start streaming based on mode
			const mode = streamingModes.get(cameraName) || 'webrtc';
			if (mode === 'websocket') {
				setTimeout(() => startWebSocketStream(cameraName), 100);
			} else if (mode === 'webrtc') {
				setTimeout(() => startWebRtcStream(cameraName), 100);
			}
			
			showFeedbackMsg(`Camera '${cameraName}' started at ${resolution.width}x${resolution.height} (${mode.toUpperCase()})`, 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to start camera '${cameraName}': ${err.message}`, 'error');
		}
	}
	
	// Stop a camera
	async function stopCamera(cameraName: string) {
		try {
			stopWebSocketStream(cameraName);
			await stopWebRtcStream(cameraName);
			
			await roverApi.stopCamera(cameraName);
			activeCameras.delete(cameraName);
			activeCameras = new Set(activeCameras);
			showFeedbackMsg(`Camera '${cameraName}' stopped`, 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to stop camera '${cameraName}': ${err.message}`, 'error');
		}
	}
	
	// Start WebSocket stream
	function startWebSocketStream(cameraName: string) {
		console.log(`[CameraPanel] Starting WebSocket stream for camera '${cameraName}'`);
		
		// Get or create canvas
		const canvas = canvasRefs[cameraName];
		if (!canvas) {
			console.error(`[CameraPanel] Canvas not found for camera '${cameraName}'`);
			console.error(`[CameraPanel] Available canvas refs:`, Object.keys(canvasRefs));
			showFeedbackMsg(`Failed to start WebSocket: Canvas element not ready`, 'error');
			return;
		}
		
		console.log(`[CameraPanel] Canvas found for camera '${cameraName}':`, canvas);
		
		// Create WebSocket client
		const client = new VideoStreamClient({
			quality: 85,
			fps: targetFps(cameraName),
			autoReconnect: true
		});
		
		// Setup callbacks
		client.onMetrics((metrics) => {
			streamMetrics.set(cameraName, metrics);
			streamMetrics = new Map(streamMetrics);
		});
		
		client.onStateChange((state) => {
			console.log(`[CameraPanel] Camera '${cameraName}' state: ${state}`);
		});
		
		client.onError((error) => {
			console.error(`[CameraPanel] Camera '${cameraName}' error:`, error);
			showFeedbackMsg(`Stream error: ${error.message}`, 'error');
		});
		
		// Connect
		console.log(`[CameraPanel] Connecting WebSocket for camera '${cameraName}'...`);
		client.connect(cameraName, canvas).catch((error) => {
			console.error(`[CameraPanel] Failed to connect WebSocket:`, error);
			showFeedbackMsg(`Failed to connect WebSocket: ${error.message}`, 'error');
		});
		
		wsClients.set(cameraName, client);
		wsClients = new Map(wsClients);
		console.log(`[CameraPanel] WebSocket client created for camera '${cameraName}'`);
	}
	
	// Stop WebSocket stream
	function stopWebSocketStream(cameraName: string) {
		const client = wsClients.get(cameraName);
		if (client) {
			client.disconnect();
			wsClients.delete(cameraName);
			wsClients = new Map(wsClients);
			streamMetrics.delete(cameraName);
			streamMetrics = new Map(streamMetrics);
		}
	}
	
	// Set streaming mode (3-way: mjpeg → websocket → webrtc → mjpeg)
	async function setStreamingMode(cameraName: string, newMode: 'mjpeg' | 'websocket' | 'webrtc') {
		const currentMode = streamingModes.get(cameraName) || 'webrtc';
		if (currentMode === newMode) return;
		
		// Stop the current stream if camera is active
		if (activeCameras.has(cameraName)) {
			if (currentMode === 'websocket') stopWebSocketStream(cameraName);
			if (currentMode === 'webrtc') await stopWebRtcStream(cameraName);
		}
		
		streamingModes.set(cameraName, newMode);
		streamingModes = new Map(streamingModes);
		
		// Start new stream if camera is active
		if (activeCameras.has(cameraName)) {
			if (newMode === 'websocket') setTimeout(() => startWebSocketStream(cameraName), 50);
			if (newMode === 'webrtc') setTimeout(() => startWebRtcStream(cameraName), 50);
		}
		
		showFeedbackMsg(`Switched to ${newMode.toUpperCase()} mode`, 'success');
	}

	// Start optical-flow diagnostics on a WebRTC RGB camera
	function startOpticalFlow(cameraName: string) {
		if (!activeCameras.has(cameraName) || streamingModes.get(cameraName) !== 'webrtc' ||
			webrtcClients.get(cameraName)?.getState() !== 'connected') return;
		if (!opticalFlowReady) {
			console.warn(
				`[CameraPanel] Optical flow is not ready for '${cameraName}'`
			);
			return;
		}

		const videoEl = videoRefs[cameraName];

		if (!videoEl) {
			console.warn(
				`[CameraPanel] No video element for optical flow: '${cameraName}'`
			);
			return;
		}

		try {
			opticalFlowService.start(
				cameraName,
				videoEl,
				(result) => {
					if (result.frameCount % 30 === 0) {
						console.log(
							`[OpticalFlow] ${cameraName}`,
							{
								points: result.trackedPoints,
								dx: result.meanDx.toFixed(2),
								dy: result.meanDy.toFixed(2),
								magnitude: result.meanMagnitude.toFixed(2),
								topDy: result.topMeanDy?.toFixed(2) ?? 'unavailable',
								middleDy: result.middleMeanDy?.toFixed(2) ?? 'unavailable',
								bottomDy: result.bottomMeanDy?.toFixed(2) ?? 'unavailable',
								topPoints: result.topPoints,
								middlePoints: result.middlePoints,
								bottomPoints: result.bottomPoints,
								mediaTime: result.mediaTime,
								deltaTime: result.deltaTime
							}
						);
					}
				}
			);
		} catch (err) {
			console.error(
				`[CameraPanel] Failed to start optical flow for '${cameraName}':`,
				err
			);
		}
	}

	// Start WebRTC stream for a camera
	function startWebRtcStream(cameraName: string) {
		if (!activeCameras.has(cameraName) || (streamingModes.get(cameraName) || 'webrtc') !== 'webrtc') return;
		const previous = webrtcClients.get(cameraName);
		if (previous && ['connecting', 'connected'].includes(previous.getState())) return;
		void previous?.disconnect();
		const videoEl = videoRefs[cameraName];
		if (!videoEl) {
			showFeedbackMsg(`WebRTC: video element not ready for '${cameraName}'`, 'error');
			return;
		}

		// Clear any previous retry timer
		const existing = webrtcRetryTimers.get(cameraName);
		if (existing) { clearTimeout(existing); webrtcRetryTimers.delete(cameraName); }

		const client = new WebRtcStreamClient();
		webrtcClients.set(cameraName, client);
		webrtcClients = new Map(webrtcClients);
		rtcMetrics.delete(cameraName);
		rtcMetrics = new Map(rtcMetrics);

		client.onStateChange((s) => {
			if (webrtcClients.get(cameraName) !== client) return;
			webrtcStates.set(cameraName, s);
			webrtcStates = new Map(webrtcStates);
			if (s !== 'connected') {
				opticalFlowService.stop(cameraName);
				rtcMetrics.delete(cameraName);
				rtcMetrics = new Map(rtcMetrics);
			}
			console.log(`[CameraPanel] WebRTC '${cameraName}' state: ${s}`);
		});

		client.onError((err) => {
			console.error(`[CameraPanel] WebRTC error for '${cameraName}':`, err);
		});
		client.onMetrics(metrics => {
			if (webrtcClients.get(cameraName) !== client) return;
			rtcMetrics.set(cameraName, metrics);
			rtcMetrics = new Map(rtcMetrics);
		});

		const offerUrl = roverApi.getCameraWebRtcOfferUrl(cameraName);
		client.connect(offerUrl, videoEl, targetFps(cameraName)).then(() => {
			if (webrtcClients.get(cameraName) !== client) return;

			webrtcRetryCounts.delete(cameraName);
			startWebRtcStatusPolling(cameraName);

			// Start diagnostics on the decoded WebRTC video
			startOpticalFlow(cameraName);
		}).catch((err: Error & { status?: number }) => {
			if (err.name === 'AbortError' || webrtcClients.get(cameraName) !== client) return;
			if (err.status === 429) {
				// Capacity full — fall back to MJPEG
				showFeedbackMsg(`Too many WebRTC viewers — falling back to MJPEG for '${cameraName}'`, 'error');
				streamingModes.set(cameraName, 'mjpeg');
				streamingModes = new Map(streamingModes);
			} else if (err.status === 500 || !err.status) {
				// Retry with exponential backoff
				const retries = (webrtcRetryCounts.get(cameraName) ?? 0) + 1;
				webrtcRetryCounts.set(cameraName, retries);
				if (retries <= 5) {
					const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000);
					showFeedbackMsg(`${err.message} — retrying '${cameraName}' in ${delay / 1000}s`, 'error');
					webrtcRetryTimers.set(cameraName, setTimeout(() => {
						if (activeCameras.has(cameraName) && streamingModes.get(cameraName) === 'webrtc') {
							startWebRtcStream(cameraName);
						}
					}, delay));
				} else {
					showFeedbackMsg(`WebRTC failed for '${cameraName}' — falling back to MJPEG`, 'error');
					streamingModes.set(cameraName, 'mjpeg');
					streamingModes = new Map(streamingModes);
				}
			} else {
				showFeedbackMsg(`WebRTC error for '${cameraName}': ${err.message}`, 'error');
			}
		});

	}

	function webRtcLabel(cameraName: string) {
		const state = webrtcStates.get(cameraName);
		if (state === 'connected') return (rtcMetrics.get(cameraName)?.fps ?? 0) > 0 ? 'LIVE WebRTC' : 'WebRTC · waiting for frames';
		if (state === 'error') return 'WebRTC · connection failed';
		if (state === 'disconnected') return 'WebRTC · disconnected';
		return 'WebRTC · connecting';
	}

	// Stop WebRTC stream for a camera
	async function stopWebRtcStream(cameraName: string) {
		const retry = webrtcRetryTimers.get(cameraName);
		if (retry) clearTimeout(retry);

		webrtcRetryTimers.delete(cameraName);
		webrtcRetryCounts.delete(cameraName);

		// Stop optical-flow processing
		opticalFlowService.stop(cameraName);

		const client = webrtcClients.get(cameraName);

		webrtcClients.delete(cameraName);
		webrtcClients = new Map(webrtcClients);

		webrtcStates.delete(cameraName);
		webrtcStates = new Map(webrtcStates);

		stopWebRtcStatusPolling(cameraName);

		webrtcStatuses.delete(cameraName);
		rtcMetrics.delete(cameraName);
		rtcMetrics = new Map(rtcMetrics);
		webrtcStatuses = new Map(webrtcStatuses);

		await client?.disconnect();
	}  

	// Start polling WebRTC connection status badge every 5 s
	function startWebRtcStatusPolling(cameraName: string) {
		stopWebRtcStatusPolling(cameraName);
		const id = setInterval(async () => {
			try {
				const st = await roverApi.getCameraWebRtcStatus(cameraName);
				webrtcStatuses.set(cameraName, { active_connections: st.active_connections, max_connections: st.max_connections ?? 5 });
				webrtcStatuses = new Map(webrtcStatuses);
				// Capacity limits new offers, not viewers already connected.
			} catch { /* ignore polling errors */ }
		}, 5000);
		webrtcStatusIntervals.set(cameraName, id);
	}

	function stopWebRtcStatusPolling(cameraName: string) {
		const id = webrtcStatusIntervals.get(cameraName);
		if (id !== undefined) { clearInterval(id); webrtcStatusIntervals.delete(cameraName); }
	}

	// Handle MJPEG fps/quality slider change (debounced 300 ms)
	function handleMjpegParamChange(cameraName: string, param: 'fps' | 'quality', value: number) {
		const params = mjpegParams.get(cameraName) ?? { fps: 30, quality: 80 };
		params[param] = value;
		mjpegParams.set(cameraName, params);
		mjpegParams = new Map(mjpegParams);
		
		const existing = mjpegDebounceTimers.get(cameraName);
		if (existing) clearTimeout(existing);
		mjpegDebounceTimers.set(cameraName, setTimeout(() => {
			// Force reactivity update so <img> src re-evaluates
			mjpegParams = new Map(mjpegParams);
		}, 300));
	}
	
	// Handle resolution change
	async function handleResolutionChange(cameraName: string, resolutionKey: string) {
		const [width, height] = resolutionKey.split('x').map(Number);
		selectedResolutions.set(cameraName, { width, height });
		selectedResolutions = new Map(selectedResolutions);
		
		// If camera is active, restart with new resolution
		if (activeCameras.has(cameraName)) {
			showFeedbackMsg(`Restarting camera with ${width}x${height}...`, 'success');
			await stopCamera(cameraName);
			// Small delay to ensure camera is fully stopped
			await new Promise(resolve => setTimeout(resolve, 300));
			await startCamera(cameraName);
		}
	}
	
	// Get resolution key for select value
	function getResolutionKey(cameraName: string): string {
		const res = selectedResolutions.get(cameraName) || { width: 1280, height: 720 };
		return `${res.width}x${res.height}`;
	}
	
	// Capture image from camera
	async function captureImage(cameraName: string) {
		// Check if expedition is active
		if (!$isExpeditionActive) {
			showFeedbackMsg('No active expedition. Please start an expedition in the Science Reports section first.', 'error');
			return;
		}

		try {
			const result = await roverApi.captureCameraImage(cameraName, telemetry, $currentExpeditionId);
			
			// Add to expedition store
			expeditionStore.addCapturedImage({
				filename: result.saved,
				camera_name: cameraName,
				timestamp: new Date().toISOString(),
				expedition_id: $currentExpeditionId || '',
				file_size_mb: result.file_size_mb
			});
			
			showFeedbackMsg(`Image captured: ${result.saved} (${result.file_size_mb} MB)`, 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to capture image: ${err.message}`, 'error');
		}
	}
	
	// Stop all cameras
	async function stopAllCameras() {
		opticalFlowService.stopAll();
		try {
			// Stop all WebSocket streams
			wsClients.forEach((client) => client.disconnect());
			wsClients.clear();
			wsClients = new Map(wsClients);
			
			// Stop all WebRTC streams
			const rtcStops = Array.from(webrtcClients.entries()).map(([name, client]) => {
				const deleteUrl = roverApi.getCameraWebRtcDeleteUrl(name);
				return client.disconnect(deleteUrl).catch(() => {});
			});
			await Promise.allSettled(rtcStops);
			webrtcClients.clear();
			webrtcClients = new Map(webrtcClients);
			webrtcStatusIntervals.forEach((id) => clearInterval(id));
			webrtcStatusIntervals.clear();
			webrtcRetryTimers.forEach((id) => clearTimeout(id));
			webrtcRetryTimers.clear();
			
			await roverApi.stopAllCameras();
			activeCameras.clear();
			activeCameras = new Set(activeCameras);
			showFeedbackMsg('All cameras stopped', 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to stop cameras: ${err.message}`, 'error');
		}
	}
	
	// Get camera stream URL (MJPEG) with current fps/quality params
	function getStreamUrl(cameraName: string) {
		const params = mjpegParams.get(cameraName) ?? { fps: 30, quality: 80 };
		return roverApi.getCameraStreamUrl(cameraName, params.fps, params.quality);
	}
	
	// Get metrics for camera
	function getMetrics(cameraName: string): StreamMetrics | null {
		return streamMetrics.get(cameraName) || null;
	}
	
	// Track API status only; camera discovery reads should not retrigger cleanup.
	$effect(() => {
		if ($apiStatus === 'connected') untrack(() => { void detectCameras(); });
		else untrack(() => { if (activeCameras.size > 0) void stopAllCameras(); });
	});

	onMount(() => {
		let mounted = true;
		void opticalFlowService.initialize().then(() => {
			if (!mounted) return;
			opticalFlowReady = true;
			// A camera may connect while OpenCV is still loading.
			webrtcClients.forEach((_, cameraName) => startOpticalFlow(cameraName));
		}).catch(err => console.error('[CameraPanel] Optical flow initialization failed:', err));
		return () => {
			mounted = false;
			opticalFlowService.stopAll();
			if (activeCameras.size > 0) void stopAllCameras();
		};
	});

	// Ensure WebRTC peers are released on page unload
	onMount(() => {
		const handleUnload = () => {
			webrtcClients.forEach((client, name) => {
				client.disconnect(roverApi.getCameraWebRtcDeleteUrl(name)).catch(() => {});
			});
		};
		window.addEventListener('beforeunload', handleUnload);
		return () => window.removeEventListener('beforeunload', handleUnload);
	});
</script>

<div class="space-y-4">
	<!-- Feedback Message -->
	{#if showFeedback}
	<div class="p-3 rounded-lg flex items-center gap-2 text-sm border {feedbackType === 'success' ? 'bg-green-900/50 border-green-500' : 'bg-destructive/50 border-destructive'}">
		<AlertCircle class="w-4 h-4" />
		<p class="flex-grow">{feedbackMessage}</p>
		<button onclick={() => showFeedback = false} class="text-muted-foreground hover:text-foreground">✕</button>
	</div>
	{/if}
	
	<!-- Controls -->
	<Card.Root class="bg-card border-border">
		<Card.Header class="border-b border-border flex-row justify-between items-center">
			<Card.Title class="flex items-center gap-2">
				<Camera class="w-5 h-5 text-primary" />
				Camera Control
			</Card.Title>
			<div class="flex gap-2">
				<Button 
					variant="secondary"
					size="sm"
					onclick={detectCameras}
					disabled={loading || $apiStatus !== 'connected'}
				>
					<RefreshCw class="w-4 h-4 mr-1" />
					Detect
				</Button>
				{#if activeCameras.size > 0}
				<Button 
					variant="secondary"
					size="sm"
					onclick={stopAllCameras}
					disabled={$apiStatus !== 'connected'}
				>
					<PowerOff class="w-4 h-4 mr-1" />
					Stop All
				</Button>
				{/if}
			</div>
		</Card.Header>
		
		<Card.Content class="">
			<!-- Loading State -->
			{#if loading}
			<div class="text-center py-8 text-muted-foreground">
				<RefreshCw class="w-8 h-8 mx-auto mb-2 animate-spin" />
				<p>Detecting cameras...</p>
			</div>
			
			<!-- No Cameras -->
			{:else if cameras.length === 0}
			<div class="text-center py-8 text-muted-foreground">
				<Camera class="w-8 h-8 mx-auto mb-2 opacity-50" />
				<p>No cameras detected</p>
				<Button 
					variant="default"
					size="sm"
					class="mt-4"
					onclick={detectCameras}
					disabled={$apiStatus !== 'connected'}
				>
					Scan for Cameras
				</Button>
			</div>
			
			<!-- Camera Grid -->
			{:else}
			<div class="grid grid-cols-1 xl:grid-cols-2 gap-4">
				{#each cameras.filter(cam => cam.name !== 'microscope') as camera}
			{@const mode = streamingModes.get(camera.name) || 'webrtc'}
			{@const metrics = getMetrics(camera.name)}
			{@const webrtcStatus = webrtcStatuses.get(camera.name)}
				{@const isNamedCamera = camera.is_named !== false}
				<div class="bg-secondary rounded-lg border border-border overflow-hidden">
					<!-- Camera Header -->
					<div class="p-3 bg-card border-b border-border flex justify-between items-center">
						<div>
							<div class="flex items-center gap-2">
								<h3 class="font-semibold text-foreground">{camera.name}</h3>
								{#if !isNamedCamera}
								<Badge variant="secondary" class="text-xs">Generic</Badge>
								{/if}
							</div>
							<p class="text-xs text-muted-foreground">
								{camera.device_path}
							</p>
							<p class="text-xs text-muted-foreground">
								{camera.default_resolution} @ {camera.default_fps}fps | {camera.backend}
							</p>
						</div>
						<div class="flex items-center gap-2">
							{#if activeCameras.has(camera.name)}
							<span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
							<Badge variant="success" class="text-xs">Active</Badge>
							{:else}
							<span class="w-2 h-2 bg-muted rounded-full"></span>
							<Badge variant="secondary" class="text-xs">Inactive</Badge>
							{/if}
						</div>
					</div>
					
					<!-- Stream Mode Selector -->
					<div class="px-3 py-2 bg-card/50 border-b border-border flex items-center justify-between gap-2">
						<span class="text-xs text-muted-foreground">Mode</span>
						<div class="flex rounded-md overflow-hidden border border-border text-xs">
							<button
								onclick={() => setStreamingMode(camera.name, 'mjpeg')}
								class="px-2 py-1 transition-colors {mode === 'mjpeg' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}"
							>MJPEG</button>
							<button
								onclick={() => setStreamingMode(camera.name, 'websocket')}
								class="px-2 py-1 border-l border-border transition-colors {mode === 'websocket' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}"
							>WebSocket</button>
							<button
								onclick={() => setStreamingMode(camera.name, 'webrtc')}
								class="px-2 py-1 border-l border-border transition-colors {mode === 'webrtc' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}"
							>WebRTC</button>
						</div>
						{#if mode === 'webrtc' && webrtcStatus}
							{#if webrtcStatus.active_connections >= webrtcStatus.max_connections}
								<Badge variant="destructive" class="text-xs">Full — WebRTC unavailable</Badge>
							{:else}
								<Badge variant="secondary" class="text-xs">{webrtcStatus.active_connections}/{webrtcStatus.max_connections} connected</Badge>
							{/if}
						{/if}
					</div>

					<div class="px-3 py-1 text-xs text-muted-foreground">
						FPS target: {targetFps(camera.name)} · {mode === 'webrtc' ? 'WebRTC target' : cameraMode(camera.name).verified ? 'camera mode' : 'reported/default rate'} · stream ceiling 60
						{#if mode === 'webrtc' && rtcMetrics.has(camera.name)}
							{@const rm = rtcMetrics.get(camera.name)!}
							<div>{rm.fps.toFixed(1)} FPS / {rm.targetFps} · {(rm.bitrateBps / 1000000).toFixed(2)} Mbps · {rm.adaptiveQuality ? `Auto quality ${Math.round(rm.scale * 100)}% size` : 'Auto bitrate; quality needs backend update'}</div>
						{/if}
					</div>
					<!-- Resolution Selector -->
					<div class="px-3 py-2 bg-card/50 border-b border-border flex items-center justify-between">
						<label for={`resolution-${camera.name}`} class="text-xs text-muted-foreground">
							Resolution
						</label>
						<select
							id={`resolution-${camera.name}`}
							class="bg-secondary border border-border rounded-md px-2 py-1 text-xs text-foreground"
							value={getResolutionKey(camera.name)}
							onchange={(e) => handleResolutionChange(camera.name, e.currentTarget.value)}
							disabled={!supportedResolutions.has(camera.name) || supportedResolutions.get(camera.name)?.length === 0}
						>
							{#if supportedResolutions.has(camera.name)}
								{#each supportedResolutions.get(camera.name) || [] as res}
									<option value="{res.width}x{res.height}">
										{res.width}×{res.height}
										{#if res.width === 1920 && res.height === 1080}
											(1080p)
										{:else if res.width === 1280 && res.height === 720}
											(720p)
										{:else if res.width === 640 && res.height === 480}
											(480p)
										{:else if res.width === 320 && res.height === 240}
											(240p)
										{/if}
									</option>
								{/each}
							{:else}
								<option value="1280x720">1280×720 (720p)</option>
							{/if}
						</select>
					</div>

					<!-- Performance Metrics (WebSocket only) -->
					{#if activeCameras.has(camera.name) && mode === 'websocket' && metrics}
					<div class="px-3 py-1.5 bg-black/30 border-b border-border flex items-center justify-between text-xs font-mono">
						<div class="flex items-center gap-3">
							<span class="text-muted-foreground">FPS: <span class="text-sky-500">{metrics.fps.toFixed(1)}</span></span>
							<span class="text-muted-foreground">{((metrics.bitrateBps ?? 0) / 1000000).toFixed(2)} Mbps · Auto JPEG {metrics.quality ?? 85}</span>
							<span class="text-muted-foreground">Latency: <span class="text-sky-500">{metrics.avgLatencyMs.toFixed(0)}ms</span></span>
							<span class="text-muted-foreground">Frames: <span class="text-sky-500">{metrics.framesReceived}</span></span>
						</div>
						{#if metrics.connected}
						<Wifi class="w-3 h-3 text-green-500" />
						{:else}
						<WifiOff class="w-3 h-3 text-destructive" />
						{/if}
					</div>
					{/if}

					<!-- MJPEG FPS / Quality sliders -->
					{#if mode === 'mjpeg'}
					{@const mparams = mjpegParams.get(camera.name) ?? { fps: 30, quality: 80 }}
					<div class="px-3 py-2 bg-card/50 border-b border-border space-y-1.5">
						<div class="flex items-center gap-2 text-xs">
							<span class="text-muted-foreground w-16">FPS: <span class="text-foreground">{mparams.fps}</span></span>
							<input type="range" min="1" max="60" value={mparams.fps}
								class="flex-1 h-1 accent-primary"
								oninput={(e) => handleMjpegParamChange(camera.name, 'fps', Number(e.currentTarget.value))} />
						</div>
						<div class="flex items-center gap-2 text-xs">
							<span class="text-muted-foreground w-16">Quality: <span class="text-foreground">{mparams.quality}</span></span>
							<input type="range" min="10" max="100" value={mparams.quality}
								class="flex-1 h-1 accent-primary"
								oninput={(e) => handleMjpegParamChange(camera.name, 'quality', Number(e.currentTarget.value))} />
						</div>
					</div>
					{/if}

					<!-- Camera Stream or Placeholder -->
					<div class="relative bg-black aspect-video">
						{#if activeCameras.has(camera.name)}
							{@const measuredFps = mode === 'webrtc' ? rtcMetrics.get(camera.name)?.fps : mode === 'websocket' ? metrics?.fps : undefined}
							<div class="absolute top-2 right-2 z-10 rounded bg-black/80 px-2 py-1 text-xs font-mono tabular-nums text-white pointer-events-none"
								title={mode === 'mjpeg' ? 'Measured FPS is unavailable for an MJPEG image stream' : 'Delivered frames per second / target frames per second'}>
								{measuredFps == null ? '—' : measuredFps.toFixed(1)} FPS
								<span class="text-slate-300">/ {mode === 'mjpeg' ? (mjpegParams.get(camera.name)?.fps ?? targetFps(camera.name)) : targetFps(camera.name)} target</span>
							</div>
							{#if mode === 'websocket'}
							<!-- WebSocket Canvas -->
							{@const resolution = selectedResolutions.get(camera.name) || { width: 1280, height: 720 }}
							<canvas
								bind:this={canvasRefs[camera.name]}
								width={resolution.width}
								height={resolution.height}
								class="w-full h-full object-contain"
							></canvas>
							<div class="absolute top-2 left-2 bg-sky-500 text-white text-xs px-2 py-1 rounded font-mono flex items-center gap-1">
								<Wifi class="w-3 h-3" />
								LIVE WS
							</div>
							{:else if mode === 'webrtc'}
							<!-- WebRTC Video -->
							<video
								bind:this={videoRefs[camera.name]}
								autoplay
								playsinline
								muted
								class="w-full h-full object-contain"
							></video>
							<div class="absolute top-2 left-2 text-white text-xs px-2 py-1 rounded font-mono flex items-center gap-1"
								class:bg-green-600={webRtcLabel(camera.name) === 'LIVE WebRTC'}
								class:bg-slate-700={webRtcLabel(camera.name) !== 'LIVE WebRTC'}>
								<Radio class="w-3 h-3" />
								{webRtcLabel(camera.name)}
							</div>
							{:else}
							<!-- MJPEG Image -->
							<img
								src={getStreamUrl(camera.name)}
								alt="{camera.name} Stream"
								class="w-full h-full object-contain"
							/>
							<div class="absolute top-2 left-2 bg-destructive text-white text-xs px-2 py-1 rounded font-mono">
								LIVE MJPEG
							</div>
							{/if}
						{:else}
						<div class="flex items-center justify-center h-full text-muted">
							<div class="text-center">
								<Camera class="w-16 h-16 mx-auto mb-2 opacity-30" />
								<p class="text-sm">Camera Offline</p>
							</div>
						</div>
						{/if}
					</div>
					
					<!-- Camera Controls -->
					<div class="p-3 bg-card border-t border-border">
						<div class="flex gap-2">
							{#if activeCameras.has(camera.name)}
							<Button 
								variant="secondary"
								size="sm"
								class="flex-1"
								onclick={() => captureImage(camera.name)}
								disabled={$apiStatus !== 'connected'}
							>
								<ImageIcon class="w-4 h-4 mr-1" />
								Capture
							</Button>
							<Button 
								variant="secondary"
								size="sm"
								onclick={() => stopCamera(camera.name)}
								disabled={$apiStatus !== 'connected'}
							>
								<PowerOff class="w-4 h-4" />
							</Button>
							{:else}
							<Button 
								variant="default"
								size="sm"
								class="flex-1"
								onclick={() => startCamera(camera.name)}
								disabled={$apiStatus !== 'connected'}
							>
								<Power class="w-4 h-4 mr-1" />
								Start Camera
							</Button>
							{/if}
						</div>
					</div>
				</div>
				{/each}
			</div>
			{/if}
		</Card.Content>
	</Card.Root>
	
	<!-- Telemetry Settings -->
	{#if cameras.length > 0}
	<Card.Root class="bg-card border-border">
		<Card.Header class="border-b border-border">
			<Card.Title>Capture Telemetry</Card.Title>
			<p class="text-xs text-muted-foreground mt-1">Metadata attached to captured images</p>
		</Card.Header>
		<Card.Content class="">
			<div class="grid grid-cols-2 sm:grid-cols-3 gap-3">
				<div>
					<label for="latitude" class="text-xs text-muted-foreground block mb-1">Latitude</label>
					<input 
						id="latitude"
						type="number" 
						bind:value={telemetry.latitude}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
						step="0.0001"
					/>
				</div>
				<div>
					<label for="longitude" class="text-xs text-muted-foreground block mb-1">Longitude</label>
					<input 
						id="longitude"
						type="number" 
						bind:value={telemetry.longitude}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
						step="0.0001"
					/>
				</div>
				<div>
					<label for="altitude" class="text-xs text-muted-foreground block mb-1">Altitude (m)</label>
					<input 
						id="altitude"
						type="number" 
						bind:value={telemetry.altitude}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
					/>
				</div>
				<div>
					<label for="battery" class="text-xs text-muted-foreground block mb-1">Battery (%)</label>
					<input 
						id="battery"
						type="number" 
						bind:value={telemetry.battery_level}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
						min="0"
						max="100"
					/>
				</div>
				<div>
					<label for="mission" class="text-xs text-muted-foreground block mb-1">Mission ID</label>
					<input 
						id="mission"
						type="text" 
						bind:value={telemetry.mission_id}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
					/>
				</div>
				<div>
					<label for="rover" class="text-xs text-muted-foreground block mb-1">Rover ID</label>
					<input 
						id="rover"
						type="text" 
						bind:value={telemetry.rover_id}
						class="w-full bg-secondary border border-border rounded-md px-2 py-1 text-sm text-foreground"
					/>
				</div>
			</div>
		</Card.Content>
	</Card.Root>
	{/if}
</div>
