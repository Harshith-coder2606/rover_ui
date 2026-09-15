<script lang="ts">
	import * as roverApi from '$lib/services/roverApi';
	import { isFullscreen } from '$lib/stores/fullscreenStore';
	
	// Panels
    import ROSCameraPanel from '$lib/components/panels/RosCameraPanel.svelte';
	import CameraPanel from '$lib/components/panels/CameraPanel.svelte';
	import FullscreenCameraView from '$lib/components/panels/FullscreenCameraView.svelte';
	import ConnectionPanel from '$lib/components/panels/ConnectionPanel.svelte';
	import CommandLog from '$lib/components/panels/CommandLog.svelte';
	import RosStatusPanel from '$lib/components/panels/RosStatusPanel.svelte';
	import TeensyTopicPanel from '$lib/components/panels/TeensyTopicPanel.svelte';
	import ArmControlPanel from '$lib/components/panels/ArmControlPanel.svelte';
	import MotorRpmPanel from '$lib/components/panels/MotorRpmPanel.svelte';
	
	// Sections
	import DashboardHeader from '$lib/components/sections/DashboardHeader.svelte';
	import FeedbackMessage from '$lib/components/sections/FeedbackMessage.svelte';
	import DrivingControls from '$lib/components/sections/DrivingControls.svelte';
	import NavigationSection from '$lib/components/sections/NavigationSection.svelte';
	import RoboticArm from '$lib/components/sections/RoboticArm.svelte';
	
	// Modals
	import AutonomousModeModal from '$lib/components/modals/AutonomousModeModal.svelte';
	import WaypointsModal from '$lib/components/modals/WaypointsModal.svelte';
	import RouteAnalysisModal from '$lib/components/modals/RouteAnalysisModal.svelte';
	
	// Science Drawer & Button
	import ScienceButton from '$lib/components/controls/ScienceButton.svelte';
	import ScienceDrawer from '$lib/components/drawers/ScienceDrawer.svelte';
	
	// Modal visibility state
	let showAutoModal = $state(false);
	let showWaypointsModal = $state(false);
	let showRouteAnalysisModal = $state(false);
	
	// Science drawer state
	let showScienceDrawer = $state(false);
	let microscopeActive = $state(false);
	
	// Feedback message state
	let feedbackComponent = $state<any>(null);
	let showFeedback = $state(false);
	
	// Data state
	let waypoints = $state<any[]>([]);
	let routeAnalysis = $state<any>(null);
	let gpsLat = $state('16.5062');
	let gpsLon = $state('80.6480');
	
	// Helper function to show feedback messages
	function showFeedbackMessage(message: string, type: string = 'success') {
		if (feedbackComponent) {
			feedbackComponent.showMessage(message, type);
		}
	}
	
	// Load waypoints
	async function loadWaypoints() {
		try {
			const result = await roverApi.getWaypoints();
			waypoints = result.waypoints || [];
			showWaypointsModal = true;
		} catch (error: any) {
			showFeedbackMessage(`Failed to load waypoints: ${error.message}`, 'error');
		}
	}
	
	// Load route analysis
	async function loadRouteAnalysis() {
		try {
			const result = await roverApi.getRouteAnalysis();
			routeAnalysis = result;
			showRouteAnalysisModal = true;
		} catch (error: any) {
			showFeedbackMessage(`Failed to load route analysis: ${error.message}`, 'error');
		}
	}
</script>

<div class="p-4 sm:p-6 lg:p-8">
	<div class="max-w-screen-2xl mx-auto">
		<!-- Feedback Message -->
		<FeedbackMessage bind:this={feedbackComponent} bind:show={showFeedback} />
		
		<DashboardHeader />

		<!-- Camera Section (Full Width) -->
		<section class="mb-6">
			<div class="flex items-center justify-between mb-2">
				<span class="text-xs font-semibold tracking-widest uppercase text-slate-400">Camera Feed</span>
				<button
					class="fullscreen-trigger"
					onclick={() => {
						isFullscreen.set(true);
					}}
					aria-label="Enter fullscreen camera view"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
					Fullscreen
				</button>
			</div>
			<CameraPanel />
		</section>

		
		<main class="grid grid-cols-1 lg:grid-cols-3 gap-6">
			<div class="space-y-6 xl:col-span-1">
				<ConnectionPanel />
				
				<!-- <TeensyTopicPanel /> -->
				
			</div>

            <div class="space-y-6">
				<RosStatusPanel />
				<MotorRpmPanel />
				<CommandLog />
            </div>

            <div class="space-y-6">
				<DrivingControls 
					onEmergencyStop={showFeedbackMessage}
					onShowAutoModal={() => showAutoModal = true}
				/>
				    <!-- <ArmControlPanel /> -->
				    <!-- <NavigationSection 
					     {waypoints}
					     onViewWaypoints={loadWaypoints}
					     onViewRouteAnalysis={loadRouteAnalysis}
				         /> -->
            </div>
		</main>
	</div>
</div>

<!-- Fullscreen Camera HUD -->
{#if $isFullscreen}
	<FullscreenCameraView />
{/if}

<!-- Modals -->
<AutonomousModeModal 
	bind:show={showAutoModal}
	bind:gpsLat
	bind:gpsLon
	onSuccess={(msg: string) => showFeedbackMessage(msg, 'success')}
	onError={(msg: string) => showFeedbackMessage(msg, 'error')}
/>

<WaypointsModal 
	bind:show={showWaypointsModal}
	{waypoints}
/>

<RouteAnalysisModal 
	bind:show={showRouteAnalysisModal}
	{routeAnalysis}
/>

<!-- Science Drawer & Button -->
<ScienceButton 
	onclick={() => showScienceDrawer = true}
	{microscopeActive}
/>

<ScienceDrawer 
	bind:show={showScienceDrawer}
	bind:microscopeActive={microscopeActive}
/>

<style>
	:global(.card) {
		background: var(--slate-900);
		border: 1px solid var(--slate-800);
		border-radius: 0.5rem;
	}

	:global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 0.5rem 1rem;
		border-radius: 0.375rem;
		font-weight: 500;
		transition: all 0.15s ease;
		border: 1px solid transparent;
	}
	
	:global(.btn:hover) {
		opacity: 0.9;
	}

	:global(.btn-primary) {
		background-color: var(--sky-blue);
		color: white;
		border-color: var(--sky-blue);
	}

	.fullscreen-trigger {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 12px;
		border-radius: 6px;
		font-size: 0.72rem;
		font-weight: 500;
		letter-spacing: 0.04em;
		color: rgba(148, 163, 184, 0.8);
		background: rgba(30, 41, 59, 0.7);
		border: 1px solid rgba(51, 65, 85, 0.6);
		cursor: pointer;
		transition: background 0.15s, color 0.15s, border-color 0.15s;
	}

	.fullscreen-trigger:hover {
		background: rgba(14, 165, 233, 0.15);
		color: #0ea5e9;
		border-color: rgba(14, 165, 233, 0.4);
	}

	:global(.btn-primary:hover) {
		background-color: var(--sky-light);
		border-color: var(--sky-light);
	}

	:global(.btn-secondary) {
		background-color: var(--slate-800);
		color: var(--slate-300);
		border-color: var(--slate-700);
	}
	
	:global(.btn-secondary:hover) {
		background-color: var(--slate-700);
		border-color: var(--slate-600);
	}
</style>
