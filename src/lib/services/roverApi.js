/**
 * Rover API Service
 * Handles all HTTP requests to the FastAPI backend
 */

// Shared by the request service, connection store, and connection form.
export const DEFAULT_API_URL = 'http://192.168.1.3:6767';
let API_BASE_URL = DEFAULT_API_URL;

export function setApiBaseUrl(url) {
    API_BASE_URL = url.trim().replace(/\/+$/, '');
}

export function getApiBaseUrl() {
    return API_BASE_URL;
}

/**
 * Generic API request handler
 */
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    
    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        return await response.json();
    } catch (error) {
        console.error(`API Request failed for ${endpoint}:`, error);
        throw error;
    }
}

// ============================================
// NAVIGATION ENDPOINTS (/api/nav/)
// ============================================

/**
 * Get available navigation endpoints
 */
export async function getNavEndpoints() {
    return apiRequest('/api/nav/available', { method: 'POST' });
}

/**
 * Capture camera screenshot with metadata
 */
export async function captureImage(formData) {
    const url = `${API_BASE_URL}/api/nav/capture`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData // FormData already sets correct Content-Type
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Capture test data (generates dummy image)
 */
export async function captureTestData(data = {}) {
    const formData = new FormData();
    Object.keys(data).forEach(key => {
        formData.append(key, data[key]);
    });
    
    const url = `${API_BASE_URL}/api/nav/capture_test_data`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Add a waypoint
 */
export async function addWaypoint(data) {
    const formData = new FormData();
    Object.keys(data).forEach(key => {
        formData.append(key, data[key]);
    });
    
    const url = `${API_BASE_URL}/api/nav/waypoint`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Get waypoints
 */
export async function getWaypoints(missionId = null) {
    const params = missionId ? `?mission_id=${missionId}` : '';
    return apiRequest(`/api/nav/get_waypoints${params}`, { method: 'GET' });
}

/**
 * Get metadata
 */
export async function getMetadata(missionId = null) {
    const params = missionId ? `?mission_id=${missionId}` : '';
    return apiRequest(`/api/nav/get_metadata${params}`, { method: 'GET' });
}

/**
 * Generate mission report
 */
export async function generateReport(missionId = 'default') {
    const params = `?mission_id=${missionId}`;
    return apiRequest(`/api/nav/generate_report${params}`, { method: 'POST' });
}

/**
 * Generate comprehensive report with PDF
 */
export async function generateComprehensiveReport(missionId = 'default') {
    const params = `?mission_id=${missionId}`;
    return apiRequest(`/api/nav/generate_comprehensive_report${params}`, { method: 'POST' });
}

/**
 * Get route analysis
 */
export async function getRouteAnalysis(missionId = 'default') {
    const params = `?mission_id=${missionId}`;
    return apiRequest(`/api/nav/route_analysis${params}`, { method: 'POST' });
}

/**
 * Export data
 */
export async function exportData(missionId = null, format = 'json') {
    const params = new URLSearchParams();
    if (missionId) params.append('mission_id', missionId);
    params.append('format', format);
    
    return apiRequest(`/api/nav/export_data?${params.toString()}`, { method: 'POST' });
}

/**
 * List reports
 */
export async function listReports() {
    return apiRequest('/api/nav/reports', { method: 'POST' });
}

// ============================================
// MOTOR RPM ENDPOINTS (/api/nav/ros/motor_rpms)
// ============================================

/**
 * Subscribe to motor RPM topic (call once on page load)
 */
export async function subscribeMotorRpms() {
    return apiRequest('/api/nav/ros/motor_rpms/subscribe', { method: 'POST' });
}

/**
 * Get latest motor RPM data
 */
export async function getMotorRpms() {
    return apiRequest('/api/nav/ros/motor_rpms', { method: 'GET' });
}

// ============================================
// DIAGNOSTICS ENDPOINTS (/api/dgt/)
// ============================================

/**
 * Get available diagnostics endpoints
 */
export async function getDiagnosticsEndpoints() {
    return apiRequest('/api/dgt/available', { method: 'POST' });
}

/**
 * Run ROS2 doctor diagnostics
 */
export async function runDoctor() {
    return apiRequest('/api/dgt/doctor', { method: 'POST' });
}

// ============================================
// SCIENCE ENDPOINTS (/api/sci/)
// ============================================

/**
 * Get available science endpoints
 */
export async function getScienceEndpoints() {
    return apiRequest('/api/sci/available', { method: 'POST' });
}

/**
 * Get science sensor data (NPK, pH, CO2, temp, humidity, etc.)
 */
export async function getScienceSensorData() {
    return apiRequest('/api/sci/sensor_data', { method: 'POST' });
}

/**
 * Assign a new expedition ID
 */
export async function assignExpedition() {
    return apiRequest('/api/sci/assign_expedition', { method: 'POST' });
}

/**
 * Check expedition status (processed, unprocessed, or not_found)
 */
export async function checkExpeditionStatus(expeditionId) {
    return apiRequest(`/api/sci/expedition_check/${expeditionId}`, { method: 'GET' });
}

/**
 * List all expeditions (processed and unprocessed)
 */
export async function listExpeditions() {
    return apiRequest('/api/sci/expeditions_list', { method: 'POST' });
}

/**
 * Assign a new navigation expedition ID
 */
export async function assignNavigationExpedition() {
    return apiRequest('/api/nav/assign_expedition', { method: 'POST' });
}

/**
 * Check navigation expedition status (processed, unprocessed, or not_found)
 */
export async function checkNavigationExpeditionStatus(expeditionId) {
    return apiRequest(`/api/nav/expedition_check/${expeditionId}`, { method: 'GET' });
}

/**
 * List all navigation expeditions (processed and unprocessed)
 */
export async function listNavigationExpeditions() {
    return apiRequest('/api/nav/expeditions_list', { method: 'POST' });
}

// ============================================
// SCIENCE CONTROL ENDPOINTS (/api/sci/control/)
// ============================================

/**
 * Toggle science exploration mode on/off
 */
export async function enableScienceMode(enable) {
    return apiRequest('/api/sci/control/enable', {
        method: 'POST',
        body: JSON.stringify({ enable })
    });
}

/**
 * Send linear actuator command
 * -1=down, 1=up, 0/4/8/16=microstep modes
 */
export async function sendLinearActuatorCmd(command) {
    return apiRequest('/api/sci/control/linear_actuator', {
        method: 'POST',
        body: JSON.stringify({ command })
    });
}

/**
 * Send drill motor command
 * -2=CW, -1=decrease speed, 0=stop, 1=increase speed, 2=CCW
 */
export async function sendDrillCmd(command) {
    return apiRequest('/api/sci/control/drill', {
        method: 'POST',
        body: JSON.stringify({ command })
    });
}

/**
 * Send barrel motor command
 * 1=rotate 60°, 0/4/8/16=microstep modes
 */
export async function sendBarrelCmd(command) {
    return apiRequest('/api/sci/control/barrel', {
        method: 'POST',
        body: JSON.stringify({ command })
    });
}

/**
 * Toggle PH servo position
 */
export async function toggleServo(toggle) {
    return apiRequest('/api/sci/control/servo', {
        method: 'POST',
        body: JSON.stringify({ toggle })
    });
}

/**
 * Send full science control command
 */
export async function sendScienceControl(controlData) {
    return apiRequest('/api/sci/control/command', {
        method: 'POST',
        body: JSON.stringify(controlData)
    });
}

/**
 * Get science control status
 */
export async function getScienceControlStatus() {
    return apiRequest('/api/sci/control/status', { method: 'GET' });
}

// ============================================
// SCIENCE DRILL TELEMETRY ENDPOINTS (/api/sci/drill/)
// ============================================

/**
 * Subscribe to drill telemetry data
 */
export async function subscribeToDrillData() {
    return apiRequest('/api/sci/drill/subscribe', { method: 'POST' });
}

/**
 * Get latest drill telemetry (distance, IMU, halted status)
 */
export async function getDrillData() {
    return apiRequest('/api/sci/drill/data', { method: 'GET' });
}

/**
 * Subscribe to science warnings/alerts
 */
export async function subscribeToScienceWarnings() {
    return apiRequest('/api/sci/warnings/subscribe', { method: 'POST' });
}

/**
 * Get latest science warning code
 */
export async function getScienceWarnings() {
    return apiRequest('/api/sci/warnings', { method: 'GET' });
}

/**
 * Get all warning code definitions
 */
export async function getScienceWarningCodes() {
    return apiRequest('/api/sci/warnings/codes', { method: 'GET' });
}

// ============================================
// ARM ENDPOINTS (/api/arm/)
// ============================================

/**
 * Get available arm endpoints
 */
export async function getArmEndpoints() {
    return apiRequest('/api/arm/available', { method: 'POST' });
}

/**
 * Get arm telemetry data
 */
export async function getArmData() {
    return apiRequest('/api/arm/data', { method: 'POST' });
}

/**
 * Send arm command (1=drop, -1=stop)
 */
export async function sendArmCommand(command) {
    return apiRequest('/api/arm/ros/command', {
        method: 'POST',
        body: JSON.stringify({ command })
    });
}

/**
 * Trigger drop payload sequence
 */
export async function dropPayload() {
    return apiRequest('/api/arm/ros/drop', { method: 'POST' });
}

/**
 * Emergency stop arm
 */
export async function stopArm() {
    return apiRequest('/api/arm/ros/stop', { method: 'POST' });
}

/**
 * Send target angles to arm
 */
export async function sendArmTarget(angles) {
    return apiRequest('/api/arm/ros/target', {
        method: 'POST',
        body: JSON.stringify(angles)
    });
}

/**
 * Subscribe to arm telemetry
 */
export async function subscribeToArmTelemetry() {
    return apiRequest('/api/arm/ros/telemetry/subscribe', { method: 'POST' });
}

/**
 * Get latest arm telemetry
 */
export async function getArmTelemetry() {
    return apiRequest('/api/arm/ros/telemetry', { method: 'GET' });
}

// ============================================
// OTHER ENDPOINTS (/api/o/)
// ============================================

/**
 * Get available other endpoints
 */
export async function getOtherEndpoints() {
    return apiRequest('/api/o/available', { method: 'POST' });
}

/**
 * Test endpoint
 */
export async function testApi(data = {}) {
    return apiRequest('/api/o/test', {
        method: 'POST',
        body: JSON.stringify(data)
    });
}

// ============================================
// CAMERA ENDPOINTS (/api/nav/cameras/)
// ============================================

/**
 * Detect all connected cameras
 */
export async function detectCameras(maxCameras = 10) {
    const params = `?max_cameras=${maxCameras}`;
    return apiRequest(`/api/nav/cameras/detect${params}`, { method: 'GET' });
}

/**
 * Get supported resolutions for a specific camera
 */
export async function getSupportedResolutions(cameraName) {
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/resolutions`;
    const response = await fetch(url, {
        method: 'GET'
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Start a specific camera
 */
export async function startCamera(cameraName, width = 1280, height = 720, fps = 30, pixelFormat = undefined) {
    const formData = new FormData();
    formData.append('width', width.toString());
    formData.append('height', height.toString());
    formData.append('fps', fps.toString());
    if (pixelFormat) formData.append('pixel_format', pixelFormat);
    
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/start`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Stop a specific camera
 */
export async function stopCamera(cameraName) {
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/stop`;
    const response = await fetch(url, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Stop all cameras
 */
export async function stopAllCameras() {
    const url = `${API_BASE_URL}/api/nav/cameras/stop_all`;
    const response = await fetch(url, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Get all cameras status
 */
export async function getCamerasStatus() {
    return apiRequest('/api/nav/cameras/status', { method: 'GET' });
}

/**
 * Get specific camera status
 */
export async function getCameraStatus(cameraName) {
    return apiRequest(`/api/nav/cameras/${cameraName}/status`, { method: 'GET' });
}

/**
 * Capture image from a specific camera
 */
export async function captureCameraImage(cameraName, telemetry = {}, expeditionId = null) {
    const formData = new FormData();
    
    // Add expedition_id if provided (REQUIRED by backend)
    if (expeditionId) {
        formData.append('expedition_id', expeditionId);
    }
    
    // Add telemetry data
    Object.entries(telemetry).forEach(([key, value]) => {
        formData.append(key, value.toString());
    });
    
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/capture`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Get camera stream URL (MJPEG)
 */
export function getCameraStreamUrl(cameraName, fps = 30, quality = 80) {
    return `${API_BASE_URL}/api/nav/cameras/${cameraName}/stream?fps=${fps}&quality=${quality}`;
}

/**
 * Get camera WebRTC offer URL
 */
export function getCameraWebRtcOfferUrl(cameraName) {
    return `${API_BASE_URL}/api/nav/cameras/${cameraName}/webrtc/offer`;
}

/**
 * Get camera WebRTC delete URL
 */
export function getCameraWebRtcDeleteUrl(cameraName) {
    return `${API_BASE_URL}/api/nav/cameras/${cameraName}/webrtc`;
}

/**
 * Send WebRTC offer for a hardware camera
 */
export async function sendCameraWebRtcOffer(cameraName, sdp, type, fps = 30) {
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/webrtc/offer`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, type, fps })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.detail || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

/**
 * Close all WebRTC connections for a hardware camera
 */
export async function stopCameraWebRtc(cameraName) {
    const url = `${API_BASE_URL}/api/nav/cameras/${cameraName}/webrtc`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * Get WebRTC status for a specific hardware camera
 */
export async function getCameraWebRtcStatus(cameraName) {
    return apiRequest(`/api/nav/cameras/${cameraName}/webrtc/status`, { method: 'GET' });
}

/**
 * Get WebRTC status for all hardware cameras
 */
export async function getAllCamerasWebRtcStatus() {
    return apiRequest('/api/nav/cameras/webrtc/status', { method: 'GET' });
}

/**
 * Send WebRTC offer for the ROS camera
 */
export async function sendRosCameraWebRtcOffer(sdp, type, fps = 30, topicName = null) {
    const url = `${API_BASE_URL}/api/nav/ros/camera/webrtc/offer`;
    const body = { sdp, type, fps };
    if (topicName) body.topic_name = topicName;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.detail || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

/**
 * Close all WebRTC connections for the ROS camera
 */
export async function stopRosCameraWebRtc() {
    const url = `${API_BASE_URL}/api/nav/ros/camera/webrtc`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * Get WebRTC status for the ROS camera
 */
export async function getRosCameraWebRtcStatus() {
    return apiRequest('/api/nav/ros/camera/webrtc/status', { method: 'GET' });
}

/**
 * Get ROS camera WebSocket stream URL
 */
export function getRosCameraWebSocketUrl(quality = 85, fps = 30) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = API_BASE_URL.replace(/^https?:\/\//, '');
    return `${protocol}//${host}/api/nav/ros/camera/ws?quality=${quality}&fps=${fps}`;
}

/**
 * Send WebRTC offer for the science microscope
 */
export async function sendMicroscopeWebRtcOffer(sdp, type, fps = 30) {
    const url = `${API_BASE_URL}/api/sci/microscope/webrtc/offer`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sdp, type, fps })
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.detail || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
    }
    return response.json();
}

/**
 * Close all WebRTC connections for the microscope
 */
export async function stopMicroscopeWebRtc() {
    const url = `${API_BASE_URL}/api/sci/microscope/webrtc`;
    const response = await fetch(url, { method: 'DELETE' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/**
 * Get WebRTC status for the microscope
 */
export async function getMicroscopeWebRtcStatus() {
    return apiRequest('/api/sci/microscope/webrtc/status', { method: 'GET' });
}

/**
 * Get camera WebSocket stream URL
 */
export function getCameraWebSocketUrl(cameraName, quality = 85, fps = 30) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = API_BASE_URL.replace(/^https?:\/\//, '');
    return `${protocol}//${host}/api/nav/cameras/${cameraName}/ws?quality=${quality}&fps=${fps}`;
}

/**
 * Get WebSocket streaming status for all cameras
 */
export async function getWebSocketStatus() {
    return apiRequest('/api/nav/cameras/ws/status', { method: 'GET' });
}

/**
 * Get WebSocket streaming status for specific camera
 */
export async function getCameraWebSocketStatus(cameraName) {
    return apiRequest(`/api/nav/cameras/${cameraName}/ws/status`, { method: 'GET' });
}

// ============================================
// MICROSCOPE ENDPOINTS (/api/sci/microscope/)
// ============================================

/**
 * Start microscope device
 */
export async function startMicroscope(width = 640, height = 480, fps = 30) {
    const formData = new FormData();
    formData.append('width', width.toString());
    formData.append('height', height.toString());
    formData.append('fps', fps.toString());
    
    const url = `${API_BASE_URL}/api/sci/microscope/start`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Stop microscope device
 */
export async function stopMicroscope() {
    const url = `${API_BASE_URL}/api/sci/microscope/stop`;
    const response = await fetch(url, {
        method: 'POST'
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

/**
 * Get microscope status
 */
export async function getMicroscopeStatus() {
    return apiRequest('/api/sci/microscope/status', { method: 'GET' });
}

/**
 * Get microscope MJPEG stream URL
 */
export function getMicroscopeStreamUrl(fps = 30, quality = 80) {
    return `${API_BASE_URL}/api/sci/microscope/stream?fps=${fps}&quality=${quality}`;
}

/**
 * Capture microscope image with metadata
 */
export async function captureMicroscopeImage(metadata, expeditionId = null) {
    const formData = new FormData();
    
    // Add expedition_id if provided
    if (expeditionId) {
        formData.append('expedition_id', expeditionId);
    }
    
    formData.append('latitude', metadata.latitude);
    formData.append('longitude', metadata.longitude);
    formData.append('altitude', metadata.altitude);
    formData.append('battery_level', metadata.battery_level);
    formData.append('mission_id', metadata.mission_id);
    formData.append('rover_id', metadata.rover_id);
    formData.append('note', metadata.note || '');
    formData.append('tags', 'microscope,science'); // Auto-tags
    
    const url = `${API_BASE_URL}/api/sci/microscope/capture`;
    const response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
}

// ============================================
// ROS BRIDGE ENDPOINTS (/api/ros/ and /api/nav/ros/)
// ============================================

/**
 * Get ROS connection status
 */
export async function getRosStatus() {
    return apiRequest('/api/ros/status', { method: 'GET' });
}

/**
 * Connect to ROS manually
 */
export async function connectToRos() {
    return apiRequest('/api/ros/connect', { method: 'POST' });
}

/**
 * Disconnect from ROS
 */
export async function disconnectFromRos() {
    return apiRequest('/api/ros/disconnect', { method: 'POST' });
}

/**
 * Publish velocity command to /cmd_vel
 */
export async function publishCmdVel(velocityCommand, signal) {
    return apiRequest('/api/nav/ros/cmd_vel', {
        method: 'POST',
        body: JSON.stringify(velocityCommand),
        signal
    });
}

/**
 * Send stop command to rover
 */
export async function stopRover() {
    return apiRequest('/api/nav/ros/cmd_vel/stop', { method: 'POST' });
}

/**
 * Subscribe to odometry data
 */
export async function subscribeToOdometry() {
    return apiRequest('/api/nav/ros/odom/subscribe', { method: 'POST' });
}

/**
 * Get latest odometry data
 */
export async function getOdometry() {
    return apiRequest('/api/nav/ros/odom', { method: 'GET' });
}

/**
 * Get latest teensy topic data
 */
export async function getTeensyTopic() {
    return apiRequest('/api/o/teensy_topic', { method: 'GET' });
}

/**
 * Unsubscribe from teensy topic
 */
export async function unsubscribeTeensyTopic() {
    return apiRequest('/api/o/teensy_topic/unsubscribe', { method: 'POST' });
}

/**
 * Debug teensy topic state
 */
export async function debugTeensyTopic() {
    return apiRequest('/api/o/teensy_topic/debug', { method: 'GET' });
}

/**
 * Publish custom ROS message
 */
export async function publishRosMessage(topic, messageType, message) {
    return apiRequest('/api/nav/ros/publish', {
        method: 'POST',
        body: JSON.stringify({ topic, message_type: messageType, message })
    });
}

// ============================================
// ROS CAMERA ENDPOINTS (/api/nav/ros/camera/)
// ============================================

/**
 * Subscribe to ROS camera image topic
 */
export async function subscribeToRosCamera(topicName = '/camera/camera/color/image_raw') {
    return apiRequest('/api/nav/ros/camera/subscribe', {
        method: 'POST',
        body: JSON.stringify({ topic_name: topicName })
    });
}

/**
 * Get latest ROS camera image data
 */
export async function getLatestRosCameraImage(topicName = null) {
    const params = topicName ? `?topic_name=${topicName}` : '';
    return apiRequest(`/api/nav/ros/camera/latest${params}`, { method: 'GET' });
}

/**
 * Get ROS camera MJPEG stream URL
 */
export function getRosCameraStreamUrl(topicName = null, fps = 30, quality = 80) {
    const params = new URLSearchParams();
    if (topicName) params.set('topic_name', topicName);
    params.set('fps', fps.toString());
    params.set('quality', quality.toString());
    return `${API_BASE_URL}/api/nav/ros/camera/stream?${params.toString()}`;
}

/**
 * Unsubscribe from ROS camera topic
 */
export async function unsubscribeFromRosCamera(topicName = '/camera/camera/color/image_raw') {
    return apiRequest('/api/nav/ros/camera/unsubscribe', {
        method: 'POST',
        body: JSON.stringify({ topic_name: topicName })
    });
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Check if API is reachable
 */
export async function checkApiHealth() {
    try {
        const response = await testApi({ ping: true });
        return response.success === true;
    } catch (error) {
        return false;
    }
}

/**
 * Get all available endpoints from all modules
 */
export async function getAllEndpoints() {
    try {
        const [nav, dgt, sci, arm, other] = await Promise.all([
            getNavEndpoints().catch(() => ({ endpoints: [] })),
            getDiagnosticsEndpoints().catch(() => ({ endpoints: [] })),
            getScienceEndpoints().catch(() => ({ endpoints: [] })),
            getArmEndpoints().catch(() => ({ endpoints: [] })),
            getOtherEndpoints().catch(() => ({ endpoints: [] }))
        ]);
        
        return {
            navigation: nav.endpoints || [],
            diagnostics: dgt.endpoints || [],
            science: sci.endpoints || [],
            arm: arm.endpoints || [],
            other: other.endpoints || []
        };
    } catch (error) {
        console.error('Failed to fetch endpoints:', error);
        return {
            navigation: [],
            diagnostics: [],
            science: [],
            arm: [],
            other: []
        };
    }
}

// ============================================
// ARDUINO NAVIGATION ENDPOINTS (/api/nav/arduino/)
// ============================================

/**
 * Connect to Arduino
 */
export async function connectArduino() {
    return apiRequest('/api/nav/arduino/connect', { method: 'POST' });
}

/**
 * Disconnect from Arduino
 */
export async function disconnectArduino() {
    return apiRequest('/api/nav/arduino/disconnect', { method: 'POST' });
}

/**
 * Get Arduino connection status
 */
export async function getArduinoStatus() {
    return apiRequest('/api/nav/arduino/status', { method: 'GET' });
}

/**
 * Send raw command to Arduino (W, S, A, D, X)
 */
export async function sendArduinoCommand(command, signal) {
    return apiRequest('/api/nav/arduino/cmd', {
        method: 'POST',
        body: JSON.stringify({ command }),
        signal
    });
}

/**
 * Send direction to Arduino (forward, backward, left, right, stop)
 */
export async function sendArduinoDirection(direction) {
    return apiRequest('/api/nav/arduino/direction', {
        method: 'POST',
        body: JSON.stringify({ direction })
    });
}

/**
 * Send stop command to Arduino
 */
export async function stopArduino() {
    return apiRequest('/api/nav/arduino/stop', { method: 'POST' });
}

/**
 * Reconnect to Arduino
 */
export async function reconnectArduino() {
    return apiRequest('/api/nav/arduino/reconnect', { method: 'POST' });
}
