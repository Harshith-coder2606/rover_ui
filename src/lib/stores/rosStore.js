import { writable, derived } from 'svelte/store';
import * as api from '$lib/services/roverApi.js';

// Commanded velocity (set by DrivingControls on every command dispatch)
export const commandedVelocity = writable({ linear: 0, angular: 0 });

// ROS connection status
export const rosStatus = writable({
	status: 'disconnected',
	url: null,
	subscribedTopics: [],
	publishedTopics: [],
	lastChecked: null
});
export const isRosConnected = derived(rosStatus, $status => $status.status === 'connected');

// Teensy topic data
export const teensyTopicData = writable(null);

// Check ROS status
export async function checkRosStatus() {
	try {
		const response = await api.getRosStatus();
		const statusData = response.status || {};
		const connected = statusData.connected === true;
		
		rosStatus.set({
			status: connected ? 'connected' : 'disconnected',
			url: statusData.url || null,
			subscribedTopics: statusData.subscribed_topics || [],
			publishedTopics: statusData.published_topics || [],
			lastChecked: Date.now()
		});
		
		return { connected };
	} catch (error) {
		console.error('Error checking ROS status:', error);
		rosStatus.set({
			status: 'disconnected',
			url: null,
			subscribedTopics: [],
			publishedTopics: [],
			lastChecked: Date.now()
		});
		return { connected: false };
	}
}

// Connect to ROS
export async function connectToRos(rosUrl) {
	try {
		rosStatus.update(s => ({ ...s, status: 'connecting' }));
		const response = await api.connectToRos();
		if (response.success) {
			rosStatus.update(s => ({ ...s, status: 'connected', url: response.url }));
			return { success: true };
		} else {
			rosStatus.update(s => ({ ...s, status: 'disconnected' }));
			return { success: false, error: response.message || 'Connection failed' };
		}
	} catch (error) {
		rosStatus.update(s => ({ ...s, status: 'disconnected' }));
		return { success: false, error: error.message };
	}
}

// Disconnect from ROS
export async function disconnectFromRos() {
	try {
		await api.disconnectFromRos();
		rosStatus.update(s => ({ ...s, status: 'disconnected', subscribedTopics: [], publishedTopics: [] }));
	} catch (error) {
		console.error('Error disconnecting from ROS:', error);
		rosStatus.update(s => ({ ...s, status: 'disconnected' }));
	}
}

// Stop the rover
export async function stopRover() {
	try {
		const response = await api.stopRover();
		return response.success === true;
	} catch (error) {
		console.error('Error stopping rover:', error);
		return false;
	}
}

// Publish command velocity to ROS
export async function publishCmdVel(linearX, angularZ, signal) {
	try {
		commandedVelocity.set({ linear: linearX, angular: angularZ });
		const velocityCommand = {
			linear_x: linearX,
			linear_y: 0.0,
			linear_z: 0.0,
			angular_x: 0.0,
			angular_y: 0.0,
			angular_z: angularZ
		};
		const response = await api.publishCmdVel(velocityCommand, signal);
		return response;
	} catch (error) {
		console.error('Error publishing cmd_vel:', error);
		throw error;
	}
}

// Start teensy topic updates
export async function startTeensyTopicUpdates(rate) {
	const intervalId = setInterval(async () => {
		try {
			const response = await api.getTeensyTopic();
			if (response.success && response.data) {
				teensyTopicData.set(response.data);
			}
		} catch (error) {
			console.error('Error fetching teensy topic data:', error);
		}
	}, rate);
	
	return intervalId;
}

// Stop teensy topic updates
export async function stopTeensyTopicUpdates(intervalId) {
	clearInterval(intervalId);
	try {
		await api.unsubscribeTeensyTopic();
	} catch (error) {
		console.error('Error unsubscribing from teensy topic:', error);
	}
	teensyTopicData.set(null);
}

// Subscribe to odometry
export async function subscribeToOdometry() {
	try {
		const response = await api.subscribeToOdometry();
		return response.success === true;
	} catch (error) {
		console.error('Error subscribing to odometry:', error);
		return false;
	}
}

// Get latest odometry data
export async function getOdometry() {
	try {
		const response = await api.getOdometry();
		return response.data || null;
	} catch (error) {
		console.error('Error getting odometry:', error);
		return null;
	}
}
