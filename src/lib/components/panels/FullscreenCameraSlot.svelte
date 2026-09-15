<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { VideoStreamClient, WebRtcStreamClient, WEBRTC_TARGET_FPS } from '$lib/services/videoStreamService';
  import { getApiBaseUrl, startCamera, stopCamera, getSupportedResolutions } from '$lib/services/roverApi';
  import { selectCameraMode } from '$lib/services/cameraStreamProfile.js';

  let { 
    config = $bindable(), 
    availableCameras = [], 
    onConfigure, 
    onRemove 
  } = $props();

  let selectedCamera = $state(config.cameraId || '');
  let selectedType = $state(config.streamType || 'mjpeg');
  let selectedResolution = $state(config.resolution || '720p');

  // FPS Tracking
  let actualFps = $state<number | null>(null);
  let streamError = $state('');

  let videoRef = $state(null);
  let imgRef = $state(null);
  let canvasRef = $state(null);

  let wsClient = null;
  let rtcClient = null;

  function baseUrl() {
    return getApiBaseUrl();
  }

  function getBaseUrl() {
    return baseUrl();
  }

  function getWsUrl() {
    return baseUrl().replace('http://', 'ws://').replace('https://', 'wss://');
  }

  let isRos = $derived(selectedCamera === 'ros');
  let streamQuality = $derived(selectedResolution === '1080p' ? 90 : selectedResolution === '720p' ? 80 : 60);
  let streamFps = $state(30);
  let rtcMetrics = $state(null);

  function mjpegUrl() {
    if (isRos) {
      return `${getBaseUrl()}/api/nav/ros/camera/stream?topic_name=${encodeURIComponent('/camera/image_raw')}&fps=${streamFps}&quality=${streamQuality}`;
    }
    return `${getBaseUrl()}/api/nav/cameras/${encodeURIComponent(selectedCamera)}/stream?fps=${streamFps}&quality=${streamQuality}`;
  }

  function wsUrl() {
    if (isRos) {
      return `${getWsUrl()}/api/nav/ros/camera/ws?quality=${streamQuality}&fps=${streamFps}`;
    }
    return `${getWsUrl()}/api/nav/cameras/${encodeURIComponent(selectedCamera)}/ws?quality=${streamQuality}&fps=${streamFps}`;
  }

  function webrtcOfferUrl() {
    if (isRos) return `${getBaseUrl()}/api/nav/ros/camera/webrtc/offer`;
    return `${getBaseUrl()}/api/nav/cameras/${encodeURIComponent(selectedCamera)}/webrtc/offer`;
  }

  function webrtcDeleteUrl() {
    if (isRos) return `${getBaseUrl()}/api/nav/ros/camera/webrtc`;
    return `${getBaseUrl()}/api/nav/cameras/${encodeURIComponent(selectedCamera)}/webrtc`;
  }

  async function teardownStream(stopBackend = true) {
    streamError = '';
    if (wsClient) {
      wsClient.disconnect();
      wsClient = null;
    }
    if (rtcClient) {
      const previous = rtcClient;
      rtcClient = null;
      await previous.disconnect(webrtcDeleteUrl());
    }
    rtcMetrics = null;
    actualFps = null;
    
    if (stopBackend && !isRos && selectedCamera) {
      try {
        await stopCamera(selectedCamera);
      } catch (e: any) {
        console.error('Failed to stop camera:', e);
      }
    }
  }

  async function initStream() {
    await teardownStream(false);
    await tick();

    if (!config.isConfigured || !selectedCamera) return;

    if (!isRos) {
      let width = 1280;
      let height = 720;
      if (selectedResolution === '1080p') { width = 1920; height = 1080; }
      else if (selectedResolution === '480p') { width = 640; height = 480; }
      
      try {
        const camera = availableCameras.find(cam => (cam.id || cam.name) === selectedCamera);
        const capabilities = await getSupportedResolutions(selectedCamera).catch(() => ({ formats: [] }));
        const profile = selectCameraMode(capabilities.formats, width, height, camera?.default_fps);
        const started = await startCamera(selectedCamera, width, height, profile.fps, profile.pixelFormat);
        streamFps = started.camera?.fps > 0 ? Math.min(profile.fps, started.camera.fps) : profile.fps;
        // Give backend a short moment to initialize capture before attaching clients.
        await new Promise((resolve) => setTimeout(resolve, 150));
      } catch (e: any) {
        streamError = 'Failed to start camera: ' + e.message;
        console.error(streamError);
      }
    }

    if (config.streamType === 'mjpeg') {
      if (imgRef) {
        imgRef.src = mjpegUrl();
      }
    } else if (config.streamType === 'websocket') {
      if (!canvasRef) return;
      wsClient = new VideoStreamClient({ quality: streamQuality, fps: streamFps, autoReconnect: true });
      const currentClient = wsClient;
      wsClient.onMetrics(metrics => {
        if (wsClient === currentClient) actualFps = metrics.fps;
      });
      wsClient.onError((err) => { streamError = err.message || 'WebSocket Error'; });
      
      if (isRos) {
        await wsClient.connectCustom(wsUrl(), canvasRef);
      } else {
        await wsClient.connect(selectedCamera, canvasRef);
      }
      
    } else if (config.streamType === 'webrtc') {
      if (!videoRef) return;
      rtcClient = new WebRtcStreamClient();
      const currentClient = rtcClient;
      rtcClient.onMetrics(metrics => {
        if (rtcClient === currentClient) { rtcMetrics = metrics; actualFps = metrics.fps; }
      });
      rtcClient.onError((err) => { streamError = err.message || 'WebRTC Error'; });
      try {
        await rtcClient.connect(webrtcOfferUrl(), videoRef, WEBRTC_TARGET_FPS);
      } catch (err: any) {
        streamError = err.message ?? 'WebRTC failed';
      }
    }
  }

  async function handleConfigure() {
    const nextConfig = {
      ...config,
      cameraId: selectedCamera,
      streamType: selectedType,
      resolution: selectedResolution,
      isConfigured: true
    };
    config = nextConfig;

    if (onConfigure) {
      onConfigure(config.id, {
        cameraId: selectedCamera,
        streamType: selectedType,
        resolution: selectedResolution,
        isConfigured: true
      });
    }
  }

  async function handleEdit() {
    await teardownStream(true);
    config = {
      ...config,
      isConfigured: false
    };
  }

  $effect(() => {
    if (config.isConfigured) {
      initStream();
    } else {
      teardownStream(false);
    }
    return () => {
      teardownStream(false);
    };
  });

  onDestroy(() => {
    teardownStream(true);
  });
</script>

<div class="relative flex h-full w-full flex-col items-center justify-center border border-slate-700 bg-slate-900 overflow-hidden rounded-md">
  {#if !config.isConfigured}
    <div class="flex flex-col gap-4 p-6 w-full max-w-sm text-white bg-slate-800 rounded-lg shadow-lg">
      <h3 class="text-lg font-bold border-b border-slate-700 pb-2">Configure Camera Slot</h3>

      <div class="flex flex-col gap-3">
        <label class="flex flex-col gap-1 text-sm">
          <span>Camera</span>
          <select bind:value={selectedCamera} class="bg-slate-900 border border-slate-700 p-2 rounded text-white outline-none focus:border-blue-500">
            <option value="" disabled>Select a camera...</option>
            <option value="ros">ROS Camera</option>
            {#each availableCameras as cam}
              <option value={cam.id || cam.name}>{cam.name || cam.id}</option>
            {/each}
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span>Stream Type</span>
          <select bind:value={selectedType} class="bg-slate-900 border border-slate-700 p-2 rounded text-white outline-none focus:border-blue-500">
            <option value="mjpeg">MJPEG</option>
            <option value="webrtc">WebRTC</option>
            <option value="websocket">WebSocket</option>
          </select>
        </label>

        <label class="flex flex-col gap-1 text-sm">
          <span>Resolution</span>
          <select bind:value={selectedResolution} class="bg-slate-900 border border-slate-700 p-2 rounded text-white outline-none focus:border-blue-500">
            <option value="480p">480p</option>
            <option value="720p">720p</option>
            <option value="1080p">1080p</option>
          </select>
        </label>
      </div>

      <div class="flex justify-end gap-3 mt-4">
        {#if onRemove}
          <button onclick={() => onRemove(config.id)} class="text-red-400 hover:text-red-300 text-sm font-medium px-2">
            Remove Slot
          </button>
        {/if}
        <button 
          onclick={handleConfigure} 
          disabled={!selectedCamera} 
          class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium">
          Start Stream
        </button>
      </div>
    </div>
  {:else}
    <div class="absolute top-2 left-2 z-10 bg-black/70 px-2 py-1 rounded text-xs font-mono text-green-400 shadow backdrop-blur-sm flex flex-col gap-1">
      <div class="tabular-nums" title={config.streamType === 'mjpeg' ? 'Measured FPS is unavailable for an MJPEG image stream' : 'Delivered frames per second / target frames per second'}>{config.cameraId} | {config.streamType.toUpperCase()} | {actualFps == null ? '—' : actualFps.toFixed(1)} FPS / {config.streamType === 'webrtc' ? (rtcMetrics?.targetFps ?? WEBRTC_TARGET_FPS) : streamFps} target</div>
      {#if rtcMetrics}
        <div>Target {rtcMetrics.targetFps} FPS · {(rtcMetrics.bitrateBps / 1000000).toFixed(2)} Mbps · {rtcMetrics.adaptiveQuality ? `Auto ${Math.round(rtcMetrics.scale * 100)}% size` : 'Auto bitrate'}</div>
      {/if}
      {#if streamError}
        <div class="text-red-400">{streamError}</div>
      {/if}
    </div>
    <div class="absolute top-2 right-2 z-10 flex gap-2">
       <button 
         class="bg-black/70 px-3 py-1 rounded text-xs text-white hover:bg-black/90 shadow backdrop-blur-sm transition-colors" 
         onclick={handleEdit}>
         Edit
       </button>
    </div>

    <div class="w-full h-full flex items-center justify-center bg-black">
      {#if config.streamType === 'mjpeg'}
        <img 
          bind:this={imgRef}
          alt="Camera Stream" 
          class="h-full w-full object-contain"
        />
      {:else if config.streamType === 'webrtc'}
        <video 
          bind:this={videoRef}
          class="h-full w-full object-contain"
          autoplay 
          playsinline 
          muted
        ></video>
      {:else if config.streamType === 'websocket'}
        <canvas
          bind:this={canvasRef}
          class="h-full w-full object-contain"
        ></canvas>
      {/if}
    </div>
  {/if}
</div>
