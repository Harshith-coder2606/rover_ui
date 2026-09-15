<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { X, Wifi, LayoutGrid } from '@lucide/svelte';
  import { commandedVelocity } from '$lib/stores/rosStore';
  import { isFullscreen, fullscreenLayout, fullscreenSlots } from '$lib/stores/fullscreenStore';
  import { subscribeMotorRpms, getMotorRpms, detectCameras } from '$lib/services/roverApi';
  import FullscreenCameraSlot from './FullscreenCameraSlot.svelte';

  // ─── State ────────────────────────────────────────────────────────────────
  let rpms = $state({ front_left: 0, front_right: 0, mid_left: 0, mid_right: 0, rear_left: 0, rear_right: 0 });
  let rpmInterval;
  
  let availableCameras = $state([
    { id: 'ros', label: 'ROS Camera', type: 'ros' }
  ]);

  // ─── Slot Synchronization ──────────────────────────────────────────────────
  function syncLayoutSlots(layoutId) {
    const count = layoutId;
    if ($fullscreenSlots.length < count) {
      const toAdd = count - $fullscreenSlots.length;
      const newSlots = Array.from({ length: toAdd }).map((_, i) => ({
        id: $fullscreenSlots.length + i,
        isConfigured: false,
        cameraType: 'hardware',
        cameraId: '',
        topicName: '/camera/camera/color/image_raw',
        streamType: 'mjpeg',
        resolution: '720p'
      }));
      fullscreenSlots.update(s => [...s, ...newSlots]);
    } else if ($fullscreenSlots.length > count) {
      fullscreenSlots.update(s => s.slice(0, count));
    }
  }

  function handleLayoutChange(e) {
    const val = parseInt(e.target.value, 10);
    fullscreenLayout.set(val);
    syncLayoutSlots(val);
  }

  // ─── Motor RPM polling ────────────────────────────────────────────────────
  async function startRpmPolling() {
    try { await subscribeMotorRpms(); } catch (_) {}
    rpmInterval = setInterval(async () => {
      try {
        const result = await getMotorRpms();
        if (result?.success && result?.data) {
          rpms = result.data;
        }
      } catch (_) {}
    }, 200);
  }

  function stopRpmPolling() {
    if (rpmInterval) {
      clearInterval(rpmInterval);
      rpmInterval = null;
    }
  }

  // ─── Mount / Destroy ──────────────────────────────────────────────────────
  async function fetchCameras() {
    try {
      const result = await detectCameras();
      if (result && result.cameras) {
        const hwCams = result.cameras.map((c) => ({
          ...c,
          id: c.name,
          label: c.name,
          type: 'hardware'
        }));
        availableCameras = [
          ...hwCams,
          { id: 'ros', label: 'ROS Camera', type: 'ros' }
        ];
      }
    } catch (err) {
      console.error('Failed to detect cameras in fullscreen:', err);
    }
  }

  onMount(async () => {
    document.body.style.overflow = 'hidden';
    await fetchCameras();
    await startRpmPolling();

    syncLayoutSlots($fullscreenLayout);
  });

  onDestroy(async () => {
    document.body.style.overflow = '';
    stopRpmPolling();
  });

  function close() {
    isFullscreen.set(false);
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      close();
    }
  }

  // ─── Display helpers ──────────────────────────────────────────────────────
  function fmt(val, decimals = 2) {
    return val.toFixed(decimals);
  }
  function fmtRpm(val) {
    return Math.round(val).toString();
  }
  const wheelLabels = [
    { key: 'front_left',  label: 'FL' },
    { key: 'front_right', label: 'FR' },
    { key: 'mid_left',    label: 'ML' },
    { key: 'mid_right',   label: 'MR' },
    { key: 'rear_left',   label: 'RL' },
    { key: 'rear_right',  label: 'RR' },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="fullscreen-root" role="dialog" aria-modal="true" aria-label="Fullscreen camera view">

  <div class="camera-layer grid-layout-{$fullscreenLayout}">
    {#each $fullscreenSlots as slot, i (i)}
      <div class="camera-slot-wrapper">
        <FullscreenCameraSlot 
          bind:config={$fullscreenSlots[i]}
          {availableCameras}
        />
      </div>
    {/each}
  </div>

  <!-- ── Top HUD bar ─────────────────────────────────────────────────────── -->
  <div class="hud-top">
    <div class="hud-speeds">
      <div class="hud-speed-block">
        <span class="hud-label">LINEAR</span>
        <span class="hud-value">{fmt($commandedVelocity.linear)}<span class="hud-unit"> m/s</span></span>
      </div>
      <div class="hud-speed-block">
        <span class="hud-label">ANGULAR</span>
        <span class="hud-value">{fmt($commandedVelocity.angular)}<span class="hud-unit"> rad/s</span></span>
      </div>
    </div>

    <div class="hud-controls">
      <div class="layout-picker-wrap">
        <LayoutGrid size={14} class="picker-icon" />
        <select 
          class="layout-select" 
          value={$fullscreenLayout} 
          onchange={handleLayoutChange}
          aria-label="Select layout"
        >
          {#each [1, 2, 3, 4, 5, 6, 7, 8] as num}
            <option value={num}>Layout {num}</option>
          {/each}
        </select>
      </div>
    </div>
  </div>

  <!-- ── Right wheel RPM strip ───────────────────────────────────────────── -->
  <div class="hud-right">
    <div class="rpm-header">
      <Wifi size={12} />
      WHEELS RPM
    </div>
    <div class="rpm-list">
      {#each wheelLabels as { key, label }}
        <div class="rpm-row">
          <span class="rpm-label">{label}</span>
          <span class="rpm-value">{fmtRpm(rpms[key] || 0)}</span>
        </div>
      {/each}
    </div>
  </div>

  <button class="exit-btn" onclick={close} aria-label="Exit fullscreen">
    <X size={16} />
    Exit
  </button>

</div>

<style>
  .fullscreen-root {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #000;
    display: flex;
    align-items: stretch;
    overflow: hidden;
  }

  .camera-layer {
    position: absolute;
    inset: 0;
    padding-top: 56px;
    padding-right: 128px;
    background: #000;
    display: grid;
    gap: 2px;
  }

  .camera-slot-wrapper {
    position: relative;
    overflow: hidden;
    background: #0f172a;
    display: flex;
    flex-direction: column;
  }

  .grid-layout-1 {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr;
  }
  .grid-layout-2 {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: 1fr;
  }
  .grid-layout-3 {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  .grid-layout-3 > .camera-slot-wrapper:first-child {
    grid-row: span 2;
  }
  .grid-layout-4 {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  .grid-layout-5 {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  .grid-layout-5 > .camera-slot-wrapper:first-child {
    grid-column: span 2;
  }
  .grid-layout-6 {
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  .grid-layout-7 {
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }
  .grid-layout-7 > .camera-slot-wrapper:first-child {
    grid-column: span 2;
  }
  .grid-layout-8 {
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(2, 1fr);
  }

  .hud-top {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0 1.25rem;
    background: rgba(14, 20, 31, 0.65);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(51, 65, 85, 0.4);
    z-index: 10;
  }

  .hud-speeds, .hud-controls {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 1.5rem;
  }

  .hud-controls {
    gap: 0.75rem;
  }

  .hud-speed-block {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    min-width: 100px;
  }

  .hud-label {
    font-size: 0.62rem;
    letter-spacing: 0.12em;
    color: rgba(148, 163, 184, 0.8);
    text-transform: uppercase;
    font-family: 'Inter', sans-serif;
  }

  .hud-value {
    font-size: 1.35rem;
    font-weight: 700;
    font-family: 'Courier New', Courier, monospace;
    color: #0ea5e9;
    line-height: 1.2;
    letter-spacing: 0.03em;
  }

  .hud-unit {
    font-size: 0.65rem;
    color: rgba(148, 163, 184, 0.6);
    font-family: 'Inter', sans-serif;
  }

  .layout-picker-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(15, 23, 42, 0.6);
    border: 1px solid rgba(51, 65, 85, 0.5);
    border-radius: 6px;
    padding: 2px 8px 2px 6px;
    height: 26px;
  }

  .picker-icon {
    color: rgba(148, 163, 184, 0.9);
  }

  .layout-select {
    background: transparent;
    border: none;
    color: #f0f4f8;
    font-size: 0.75rem;
    font-family: 'Inter', sans-serif;
    font-weight: 500;
    outline: none;
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    padding-right: 12px;
    background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20width%3D%2210%22%20height%3D%226%22%20viewBox%3D%220%200%2010%206%22%20fill%3D%22none%22%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Cpath%20d%3D%22M1%201L5%205L9%201%22%20stroke%3D%22%2394A3B8%22%20stroke-width%3D%221.5%22%20stroke-linecap%3D%22round%22%20stroke-linejoin%3D%22round%22/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right center;
  }

  .layout-select option {
    background: #0f172a;
    color: #f0f4f8;
  }

  .hud-right {
    position: absolute;
    top: 56px;
    right: 0;
    bottom: 0;
    width: 128px;
    display: flex;
    flex-direction: column;
    padding: 1.5rem 0.85rem;
    background: rgba(14, 20, 31, 0.65);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-left: 1px solid rgba(51, 65, 85, 0.4);
    z-index: 10;
    gap: 0.5rem;
  }

  .rpm-header {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    color: rgba(148, 163, 184, 0.6);
    text-transform: uppercase;
    font-family: 'Inter', sans-serif;
    margin-bottom: 0.5rem;
  }

  .rpm-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    justify-content: stretch;
  }

  .rpm-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    flex: 1;
    border-bottom: 1px solid rgba(51, 65, 85, 0.4);
    gap: 0.15rem;
  }

  .rpm-row:first-child {
    border-top: 1px solid rgba(51, 65, 85, 0.4);
  }

  .rpm-label {
    font-size: 0.85rem;
    color: rgba(148, 163, 184, 0.75);
    font-family: 'Inter', sans-serif;
    font-weight: 600;
    letter-spacing: 0.05em;
  }

  .rpm-value {
    font-size: 1.45rem;
    font-family: 'Courier New', Courier, monospace;
    font-weight: 700;
    color: #38bdf8;
    line-height: 1;
  }

  .exit-btn {
    position: absolute;
    bottom: 1.25rem;
    right: calc(128px + 1.25rem);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.45rem 1rem;
    border-radius: 9999px;
    font-size: 0.78rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    color: #f0f4f8;
    background: rgba(14, 20, 31, 0.65);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid rgba(51, 65, 85, 0.5);
    cursor: pointer;
    z-index: 10;
    transition: background 0.15s, border-color 0.15s;
    font-family: 'Inter', sans-serif;
  }

  .exit-btn:hover {
    background: rgba(239, 68, 68, 0.25);
    border-color: rgba(239, 68, 68, 0.5);
    color: #fca5a5;
  }
</style>
