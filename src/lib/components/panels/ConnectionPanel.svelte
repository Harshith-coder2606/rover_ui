<script lang="ts">
	import { Wifi, WifiOff, Power } from '@lucide/svelte';
	import { apiStatus, roverApiUrl, testConnection, disconnectFromRover } from '$lib/stores/apiStore';
	import { DEFAULT_API_URL } from '$lib/services/roverApi';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	
	let apiUrl = $state(DEFAULT_API_URL);
	
	let isConnected = $derived($apiStatus === 'connected');
	let hasError = $derived($apiStatus === 'error');
	
	async function handleConnect() {
		if (isConnected) {
			disconnectFromRover();
		} else {
			await testConnection(apiUrl);
		}
	}
</script>

<Card.Root class="bg-card border-border">
	<Card.Header class="border-b border-border">
		<Card.Title class="flex items-center gap-2">
			{#if isConnected}
				<Wifi class="text-green-500" />
			{:else}
				<WifiOff class="text-muted-foreground" />
			{/if}
			Rover API Connection
		</Card.Title>
	</Card.Header>
	<Card.Content class="space-y-4">
		<div>
			<label for="api-url" class="block text-sm font-medium mb-2">Rover API URL</label>
			<input 
				id="api-url"
				type="text"
				bind:value={apiUrl}
				disabled={isConnected}
				class="w-full bg-secondary border border-input rounded-md p-2 text-foreground disabled:opacity-50 focus:outline-hidden focus:ring-2 focus:ring-ring"
				placeholder="http://localhost:6767"
			/>
		</div>
		
		<div class="flex items-center justify-between">
			<div>
				<p class="text-sm font-medium mb-1">Status:</p>
				{#if isConnected}
					<Badge variant="success">Connected to {$roverApiUrl}</Badge>
				{:else if hasError}
					<Badge variant="destructive">Connection Failed</Badge>
				{:else}
					<Badge variant="secondary">Disconnected</Badge>
				{/if}
			</div>
			<Button 
				variant={isConnected ? 'secondary' : 'default'}
				onclick={handleConnect}
			>
				<Power class="w-4 h-4 mr-2" />
				{isConnected ? 'Disconnect' : 'Connect'}
			</Button>
		</div>
		
		{#if !isConnected}
			<div class="text-xs text-muted-foreground bg-secondary p-3 rounded border border-border">
				<p class="font-semibold mb-1">Setup Instructions:</p>
				<ol class="list-decimal list-inside space-y-1">
					<li>Start the FastAPI backend server</li>
					<li>Enter the API URL above (default: http://localhost:6767)</li>
					<li>Click Connect to test the connection</li>
				</ol>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
