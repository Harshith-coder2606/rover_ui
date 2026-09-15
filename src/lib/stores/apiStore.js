import { writable } from "svelte/store";
import * as roverApi from "../services/roverApi.js";

// API connection status
export const apiStatus = writable("disconnected"); // 'connected' | 'disconnected' | 'connecting' | 'error'
export const roverApiUrl = writable(roverApi.DEFAULT_API_URL);

// Command history for logging
export const commandHistory = writable([]);

// Auto-connect on initialization
let autoConnectAttempted = false;
let connectionAttempt = 0;

async function connect(url, automatic = false) {
    const attempt = ++connectionAttempt;
    const normalizedUrl = url.trim().replace(/\/+$/, "");
    apiStatus.set("connecting");

    try {
        const response = await fetch(`${normalizedUrl}/api/status`, {
            method: "GET",
            signal: AbortSignal.timeout(automatic ? 3000 : 5000),
        });

        // A newer connection or a disconnect supersedes this response.
        if (attempt !== connectionAttempt) return false;

        if (response.ok) {
            // Configure requests BEFORE connected subscribers discover cameras
            // or poll ROS; the badge and the service must refer to the same host.
            roverApi.setApiBaseUrl(normalizedUrl);
            roverApiUrl.set(normalizedUrl);
            apiStatus.set("connected");
            return true;
        }
    } catch (error) {
        if (attempt !== connectionAttempt) return false;
    }

    apiStatus.set(automatic ? "disconnected" : "error");
    return false;
}

// A manual attempt also supersedes the delayed startup auto-connect.
export function testConnection(url) {
    autoConnectAttempted = true;
    return connect(url);
}

// Auto-connect to default URL
export async function autoConnect() {
    if (autoConnectAttempted) return;
    autoConnectAttempted = true;

    const defaultUrl = roverApi.DEFAULT_API_URL;
    console.log("[API] Attempting auto-connect to", defaultUrl);

    const connected = await connect(defaultUrl, true);
    console.log(connected
        ? "[API] Auto-connected successfully"
        : "[API] Auto-connect did not connect; manual connection is available");
    return connected;
}

// Initialize auto-connect (call this on app startup)
if (typeof window !== "undefined") {
    // Delay auto-connect slightly to allow page to load
    setTimeout(() => {
        autoConnect();
    }, 500);
}

// Disconnect from rover
export function disconnectFromRover() {
    autoConnectAttempted = true;
    connectionAttempt++;
    apiStatus.set("disconnected");
}

// Log a command to history
export function logCommand(command, status, response = null) {
    commandHistory.update((history) => {
        const newCommand = {
            id: crypto.randomUUID(),
            command,
            timestamp: Date.now(),
            status,
            response,
        };
        return [...history, newCommand].slice(-50); // Keep last 50 commands
    });
}
