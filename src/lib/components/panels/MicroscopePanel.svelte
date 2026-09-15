<script lang="ts">
	import { Microscope, Power, PowerOff, Camera, Wifi, WifiOff, Activity, Radio, AlertCircle } from '@lucide/svelte';
	import { apiStatus } from '$lib/stores/apiStore';
	import { expeditionStore, currentExpeditionId, isExpeditionActive } from '$lib/stores/expeditionStore';
	import * as roverApi from '$lib/services/roverApi';
	import { VideoStreamClient, WebRtcStreamClient, type StreamMetrics } from '$lib/services/videoStreamService';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { onMount } from 'svelte';
	
	// Props
	let { 
		microscopeActive = $bindable(false) 
	}: { 
		microscopeActive?: boolean 
	} = $props();
	
	// Microscope state
	let loading = $state(false);
	let error = $state<string | null>(null);
	let feedbackMessage = $state('');
	let feedbackType = $state<'success' | 'error'>('success');
	let showFeedback = $state(false);
	
	// Streaming mode: 'mjpeg' | 'websocket' | 'webrtc'
	let streamingMode = $state<'mjpeg' | 'websocket' | 'webrtc'>('webrtc');
	
	// WebSocket client
	let wsClient = $state<VideoStreamClient | null>(null);
	
	// Stream metrics
	let metrics = $state<StreamMetrics | null>(null);
	
	// Canvas ref (WebSocket)
	let canvasRef = $state<HTMLCanvasElement | undefined>();
	
	// WebRTC client
	let webrtcClient = $state<WebRtcStreamClient | null>(null);
	let videoRef = $state<HTMLVideoElement | undefined>();
	let webrtcStatus = $state<{ active_connections: number; max_connections: number } | null>(null);
	let webrtcStatusInterval: ReturnType<typeof setInterval> | null = null;
	let webrtcRetryTimer: ReturnType<typeof setTimeout> | null = null;
	let webrtcRetryCount = 0;
	
	// MJPEG fps/quality
	let mjpegFps = $state(30);
	let mjpegQuality = $state(80);
	let mjpegDebounceTimer: ReturnType<typeof setTimeout> | null = null;
	
	// Telemetry for captures
	let telemetry = $state({
		latitude: 16.5062,
		longitude: 80.6480,
		altitude: 0,
		battery_level: 85,
		mission_id: 'default',
		rover_id: 'rover_001',
		note: ''
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
	
	// Start microscope
	async function startMicroscope() {
		loading = true;
		try {
			const result = await roverApi.startMicroscope();
			microscopeActive = true;
			
			// Start streaming based on mode
			if (streamingMode === 'websocket') {
				setTimeout(() => startWebSocketStream(), 100);
			} else if (streamingMode === 'webrtc') {
				setTimeout(() => startWebRtcStream(), 100);
			}
			
			showFeedbackMsg(`Microscope started (${streamingMode.toUpperCase()})`, 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to start microscope: ${err.message}`, 'error');
		} finally {
			loading = false;
		}
	}
	
	// Stop microscope
	async function stopMicroscope() {
		try {
			stopWebSocketStream();
			await stopWebRtcStream();
			await roverApi.stopMicroscope();
			microscopeActive = false;
			showFeedbackMsg('Microscope stopped', 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to stop microscope: ${err.message}`, 'error');
		}
	}
	
	// Start WebSocket stream
	function startWebSocketStream() {
		console.log('[MicroscopePanel] Starting WebSocket stream');
		
		const canvas = canvasRef;
		if (!canvas) {
			console.error('[MicroscopePanel] Canvas not found');
			showFeedbackMsg('Failed to start WebSocket: Canvas element not ready', 'error');
			return;
		}
		
		// Create WebSocket client
		const client = new VideoStreamClient({
			quality: 85,
			fps: 30,
			autoReconnect: true
		});
		
		// Setup callbacks
		client.onMetrics((m) => {
			metrics = m;
		});
		
		client.onStateChange((state) => {
			console.log(`[MicroscopePanel] State: ${state}`);
		});
		
		client.onError((error) => {
			console.error(`[MicroscopePanel] Error:`, error);
			showFeedbackMsg(`Stream error: ${error.message}`, 'error');
		});
		
		// Connect with custom URL for microscope
		const baseUrl = roverApi.getApiBaseUrl().replace('http', 'ws');
		const wsUrl = `${baseUrl}/api/sci/microscope/stream/ws`;
		
		client.connectCustom(wsUrl, canvas).catch((error) => {
			console.error('[MicroscopePanel] Failed to connect WebSocket:', error);
			showFeedbackMsg(`Failed to connect WebSocket: ${error.message}`, 'error');
		});
		
		wsClient = client;
	}
	
	// Stop WebSocket stream
	function stopWebSocketStream() {
		if (wsClient) { wsClient.disconnect(); wsClient = null; metrics = null; }
	}

	// Start WebRTC stream
	function startWebRtcStream() {
		if (!videoRef) { showFeedbackMsg('WebRTC: video element not ready', 'error'); return; }
		if (webrtcRetryTimer) { clearTimeout(webrtcRetryTimer); webrtcRetryTimer = null; }

		const client = new WebRtcStreamClient();
		client.onStateChange((s) => console.log(`[MicroscopePanel] WebRTC state: ${s}`));
		client.onError((e) => console.error(`[MicroscopePanel] WebRTC error:`, e));

		const offerUrl = `${roverApi.getApiBaseUrl()}/api/sci/microscope/webrtc/offer`;
		client.connect(offerUrl, videoRef).then(() => {
			if (webrtcClient !== client) return;
			webrtcRetryCount = 0;
			startWebRtcStatusPolling();
		}).catch((err: Error & { status?: number }) => {
			if (err.name === 'AbortError' || webrtcClient !== client) return;
			if (err.status === 429) {
				showFeedbackMsg('Too many viewers — falling back to MJPEG', 'error');
				streamingMode = 'mjpeg';
			} else if (err.status === 400) {
				showFeedbackMsg('Microscope not started — click Start first', 'error');
			} else if (err.status === 500 || !err.status) {
				webrtcRetryCount++;
				if (webrtcRetryCount <= 5) {
					const delay = Math.min(5000 * Math.pow(2, webrtcRetryCount - 1), 60000);
					showFeedbackMsg(`Stream error — retrying in ${delay / 1000}s`, 'error');
					webrtcRetryTimer = setTimeout(() => {
						if (microscopeActive && streamingMode === 'webrtc') startWebRtcStream();
					}, delay);
				} else {
					showFeedbackMsg('WebRTC failed — falling back to MJPEG', 'error');
					streamingMode = 'mjpeg';
				}
			} else {
				showFeedbackMsg(`WebRTC error: ${err.message}`, 'error');
			}
			webrtcClient = null;
		});
		webrtcClient = client;
	}

	// Stop WebRTC stream
	async function stopWebRtcStream() {
		if (webrtcRetryTimer) clearTimeout(webrtcRetryTimer);
		webrtcRetryTimer = null;
		webrtcRetryCount = 0;
		const client = webrtcClient;
		webrtcClient = null;
		stopWebRtcStatusPolling();
		webrtcStatus = null;
		await client?.disconnect();
	}

	function startWebRtcStatusPolling() {
		stopWebRtcStatusPolling();
		webrtcStatusInterval = setInterval(async () => {
			try {
				const st = await roverApi.getMicroscopeWebRtcStatus();
				webrtcStatus = { active_connections: st.active_connections, max_connections: st.max_connections ?? 5 };
				// Capacity limits new offers, not viewers already connected.
			} catch { /* ignore */ }
		}, 5000);
	}

	function stopWebRtcStatusPolling() {
		if (webrtcStatusInterval) { clearInterval(webrtcStatusInterval); webrtcStatusInterval = null; }
	}
	
	// Toggle streaming mode (3-way cycle)
	async function toggleStreamingMode() {
		const order: Array<'mjpeg' | 'websocket' | 'webrtc'> = ['mjpeg', 'websocket', 'webrtc'];
		const next = order[(order.indexOf(streamingMode) + 1) % 3];
		
		// If microscope is active, stop old stream and start new
		if (microscopeActive) {
			if (streamingMode === 'websocket') stopWebSocketStream();
			if (streamingMode === 'webrtc') await stopWebRtcStream();
			streamingMode = next;
			if (next === 'websocket') startWebSocketStream();
			if (next === 'webrtc') startWebRtcStream();
		} else {
			streamingMode = next;
		}
		showFeedbackMsg(`Switched to ${next.toUpperCase()} mode`, 'success');
	}
	
	// Capture image
	async function captureImage() {
		// Check if expedition is active
		if (!$isExpeditionActive) {
			showFeedbackMsg('No active expedition. Please start an expedition in the Science Reports section first.', 'error');
			return;
		}

		try {
			const result = await roverApi.captureMicroscopeImage(telemetry, $currentExpeditionId);
			
			// Add to expedition store
			expeditionStore.addCapturedImage({
				filename: result.saved,
				camera_name: 'microscope',
				timestamp: new Date().toISOString(),
				expedition_id: $currentExpeditionId || '',
				file_size_mb: result.file_size_mb
			});
			
			showFeedbackMsg(`Image captured: ${result.saved} (${result.file_size_mb} MB)`, 'success');
		} catch (err: any) {
			showFeedbackMsg(`Failed to capture image: ${err.message}`, 'error');
		}
	}
	
	// Get microscope stream URL (MJPEG)
	function getStreamUrl() {
		return roverApi.getMicroscopeStreamUrl(mjpegFps, mjpegQuality);
	}

	// Handle MJPEG param change (debounced)
	function handleMjpegParamChange() {
		if (mjpegDebounceTimer) clearTimeout(mjpegDebounceTimer);
		mjpegDebounceTimer = setTimeout(() => {
			// force reactivity — nothing else needed, getStreamUrl() is called inline
			mjpegFps = mjpegFps;
		}, 300);
	}

	// Cleanup on destroy
	$effect(() => {
		return () => {
			if (microscopeActive) stopMicroscope();
		};
	});

	onMount(() => {
		const handleUnload = () => {
			if (webrtcClient) {
				webrtcClient.disconnect(`${roverApi.getApiBaseUrl()}/api/sci/microscope/webrtc`).catch(() => {});
			}
		};
		window.addEventListener('beforeunload', handleUnload);
		return () => window.removeEventListener('beforeunload', handleUnload);
	});
</script>

<Card.Root class="bg-card border-border">
	<Card.Header class="border-b border-border">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-2">
				<Microscope class="w-5 h-5 text-primary" />
				<Card.Title>Microscope</Card.Title>
			</div>
			<div class="flex items-center gap-2">
				{#if microscopeActive}
					<span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
					<Badge variant="success" class="text-xs">Active</Badge>
				{:else}
					<span class="w-2 h-2 bg-muted rounded-full"></span>
					<Badge variant="secondary" class="text-xs">Inactive</Badge>
				{/if}
			</div>
		</div>
	</Card.Header>
	
	<Card.Content class="space-y-4 pt-4">
		<!-- Feedback Message -->
		{#if showFeedback}
		<div class="p-3 rounded-lg flex items-center gap-2 text-sm border {feedbackType === 'success' ? 'bg-green-900/50 border-green-500' : 'bg-destructive/50 border-destructive'}">
			<AlertCircle class="w-4 h-4" />
			<p class="flex-grow">{feedbackMessage}</p>
			<button onclick={() => showFeedback = false} class="text-muted-foreground hover:text-foreground">✕</button>
		</div>
		{/if}
		
		<!-- Stream Mode Selector -->
		<div class="px-3 py-2 bg-secondary rounded-lg border border-border flex items-center justify-between gap-2">
			<span class="text-xs text-muted-foreground shrink-0">Stream</span>
			<div class="flex rounded-md border border-border overflow-hidden text-xs">
				{#each (['mjpeg', 'websocket', 'webrtc'] as const) as m}
				<button
					class="px-2 py-1 transition-colors {streamingMode === m ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-accent'}"
					onclick={() => toggleStreamingMode()}
					title="{m.toUpperCase()}"
				>{m === 'mjpeg' ? 'MJPEG' : m === 'websocket' ? 'WS' : 'WebRTC'}</button>
				{/each}
			</div>
			{#if streamingMode === 'webrtc' && webrtcStatus}
			<span class="text-xs {webrtcStatus.active_connections >= webrtcStatus.max_connections ? 'text-destructive' : 'text-green-500'}">
				{webrtcStatus.active_connections}/{webrtcStatus.max_connections}
				{webrtcStatus.active_connections >= webrtcStatus.max_connections ? '(Full)' : 'connected'}
			</span>
			{/if}
		</div>

		<!-- Performance Metrics (WebSocket only) -->
		{#if microscopeActive && streamingMode === 'websocket' && metrics}
		<div class="px-3 py-1.5 bg-black/30 border border-border rounded-lg flex items-center justify-between text-xs font-mono">
			<div class="flex items-center gap-3">
				<span class="text-muted-foreground">FPS: <span class="text-sky-500">{metrics.fps.toFixed(1)}</span></span>
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

		<!-- MJPEG Sliders -->
		{#if microscopeActive && streamingMode === 'mjpeg'}
		<div class="px-3 py-2 bg-secondary rounded-lg border border-border space-y-2 text-xs">
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground w-14 shrink-0">FPS</span>
				<input type="range" min="1" max="60" step="1" bind:value={mjpegFps}
					oninput={handleMjpegParamChange} class="flex-1 accent-primary" />
				<span class="w-8 text-right">{mjpegFps}</span>
			</div>
			<div class="flex items-center gap-2">
				<span class="text-muted-foreground w-14 shrink-0">Quality</span>
				<input type="range" min="10" max="100" step="5" bind:value={mjpegQuality}
					oninput={handleMjpegParamChange} class="flex-1 accent-primary" />
				<span class="w-8 text-right">{mjpegQuality}</span>
			</div>
		</div>
		{/if}

		<!-- Video Display -->
		<div class="relative bg-black rounded-lg overflow-hidden" style="aspect-ratio: 4/3;">
			{#if microscopeActive}
				{#if streamingMode === 'websocket'}
				<!-- WebSocket Canvas -->
				<canvas
					bind:this={canvasRef}
					width="640"
					height="480"
					class="w-full h-full object-contain"
				></canvas>
				<div class="absolute top-2 left-2 bg-sky-500 text-white text-xs px-2 py-1 rounded font-mono flex items-center gap-1">
					<Wifi class="w-3 h-3" />
					LIVE WS
				</div>
				{:else if streamingMode === 'webrtc'}
				<!-- WebRTC Video -->
				<video
					bind:this={videoRef}
					autoplay
					playsinline
					muted
					class="w-full h-full object-contain"
				></video>
				<div class="absolute top-2 left-2 bg-green-600 text-white text-xs px-2 py-1 rounded font-mono flex items-center gap-1">
					<Radio class="w-3 h-3" />
					LIVE WebRTC
				</div>
				{:else}
				<!-- MJPEG Image -->
				<img
					src={getStreamUrl()}
					alt="Microscope Stream"
					class="w-full h-full object-contain"
				/>
				<div class="absolute top-2 left-2 bg-destructive text-white text-xs px-2 py-1 rounded font-mono">
					LIVE MJPEG
				</div>
				{/if}
			{:else}
			<div class="flex items-center justify-center h-full text-muted">
				<div class="text-center">
					<Microscope class="w-16 h-16 mx-auto mb-2 opacity-30" />
					<p class="text-sm">Microscope Offline</p>
				</div>
			</div>
			{/if}
		</div>
		
		<!-- Controls -->
		<div class="flex gap-2">
			{#if microscopeActive}
			<Button 
				variant="secondary"
				size="sm"
				class="flex-1"
				onclick={captureImage}
				disabled={$apiStatus !== 'connected'}
			>
				<Camera class="w-4 h-4 mr-1" />
				Capture
			</Button>
			<Button 
				variant="secondary"
				size="sm"
				onclick={stopMicroscope}
				disabled={$apiStatus !== 'connected' || loading}
			>
				<PowerOff class="w-4 h-4" />
			</Button>
			{:else}
			<Button 
				variant="default"
				size="sm"
				class="flex-1"
				onclick={startMicroscope}
				disabled={$apiStatus !== 'connected' || loading}
			>
				<Power class="w-4 h-4 mr-1" />
				Start Microscope
			</Button>
			{/if}
		</div>
		
		<!-- Telemetry (collapsed by default) -->
		<details class="bg-secondary rounded-lg border border-border">
			<summary class="px-3 py-2 cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
				Capture Settings
			</summary>
			<div class="p-3 space-y-2 border-t border-border">
				<div class="grid grid-cols-2 gap-2">
					<div>
						<label class="text-xs text-muted-foreground block mb-1">Latitude</label>
						<input 
							type="number" 
							bind:value={telemetry.latitude}
							class="w-full bg-background border border-border rounded px-2 py-1 text-sm"
							step="0.0001"
						/>
					</div>
					<div>
						<label class="text-xs text-muted-foreground block mb-1">Longitude</label>
						<input 
							type="number" 
							bind:value={telemetry.longitude}
							class="w-full bg-background border border-border rounded px-2 py-1 text-sm"
							step="0.0001"
						/>
					</div>
					<div>
						<label class="text-xs text-muted-foreground block mb-1">Battery (%)</label>
						<input 
							type="number" 
							bind:value={telemetry.battery_level}
							class="w-full bg-background border border-border rounded px-2 py-1 text-sm"
							min="0"
							max="100"
						/>
					</div>
					<div>
						<label class="text-xs text-muted-foreground block mb-1">Mission ID</label>
						<input 
							type="text" 
							bind:value={telemetry.mission_id}
							class="w-full bg-background border border-border rounded px-2 py-1 text-sm"
						/>
					</div>
				</div>
				<div>
					<label class="text-xs text-muted-foreground block mb-1">Note</label>
					<input 
						type="text" 
						bind:value={telemetry.note}
						class="w-full bg-background border border-border rounded px-2 py-1 text-sm"
						placeholder="Optional capture note..."
					/>
				</div>
			</div>
		</details>
	</Card.Content>
</Card.Root>
