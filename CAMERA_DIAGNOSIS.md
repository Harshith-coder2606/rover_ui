# Camera connection diagnosis — 2026-08-27

## Requested WebRTC target: 24 FPS

WebRTC now requests a fixed 24 FPS across the camera panel, fullscreen, ROS,
and microscope clients. The backend offer defaults also use 24 and no longer
replace the requested delivery target with the driver's reported capture FPS.
Capture-mode selection and other transports remain unchanged. The overlay
continues to show measured FPS separately: requesting 24 does not guarantee
24 distinct captured frames from a slower hardware mode.

## Visible FPS counter

The camera feed now has an overlay showing measured FPS and the target. Both
WebRTC and WebSocket use the existing interval metrics; unavailable samples
show a dash. Fullscreen uses the same stream metrics instead of counting browser
animation callbacks (which reported display refresh rate, not camera FPS).
MJPEG displays a dash because image load events are not a reliable frame counter.

## Adaptive streaming and per-camera FPS follow-up

Both repositories remain on `codex/debug-camera-detection`; backend changes are
local and have not been deployed. No threading redesign was made.

- Camera capabilities now include discrete frame rates under each pixel format
  and resolution. The normal panel and fullscreen slots select the fastest
  advertised mode at the selected resolution within the existing 60 FPS stream
  ceiling, and request its FOURCC before setting capture dimensions/FPS.
  Unknown capabilities use a reported/default rate, not a claimed hardware maximum.
  The camera's start response can lower the target to the actual driver rate.
- WebRTC retains aiortc's native RTCP REMB bitrate adjustment. Receiver stats
  add measured FPS, Mbps, loss, jitter, and decode cost. New per-viewer feedback
  routes adjust encoded dimensions through scales 1.0, 0.85, 0.7, and 0.5,
  preserving the capture FPS target. Two bad samples lower quality; five healthy
  samples recover it. Each viewer has independent state and a feedback rate limit.
  Hidden tabs do not submit adaptation feedback. This does not restart hardware.
- WebRTC now uses a monotonic RTP clock at the requested FPS instead of the
  inherited fixed 30 FPS pacing. WebSocket frame pacing subtracts capture,
  encode, and send time from the frame interval instead of adding a full sleep.
- Navigation camera WebSocket JPEG quality adapts between 35 and 90, lowering
  after three slow samples and recovering after six healthy samples. Bitrate
  and quality are visible beside FPS. Raw microscope JPEG and MJPEG are not
  automatically quality-controlled by this change.
- WebSocket metrics now publish fresh snapshots; reusing the internal object
  had left the camera panel labels frozen at their first sample. Zero received
  frames now produces zero interval FPS, rather than retaining a stale rate.
- Older backend responses keep working: the client displays native automatic
  bitrate and explicitly says that adaptive WebRTC quality needs a backend update.

Verification: 28 UI regression tests and 20 backend tests pass (6 capability,
9 peer lifecycle/feedback ownership, 5 adaptation/pacing). Python syntax checks,
`git diff --check`, and `npm run build` pass; existing build warnings remain.
The backend tests use fake hardware/peers or pure policy classes, not a live
Linux camera or FastAPI routing test. New feedback polling/cancellation is
tested with mocked browser stats and HTTP responses.

Live check against the currently deployed rover: science at 1280x720 reported
10 FPS when started, despite detection's initial 30 FPS label. The UI correctly
targeted 10, and WebRTC delivered approximately 10 FPS with advancing 720p video
(`readyState=4`, playback time 24.508 seconds). Native measured bitrate varied
around 0.08–0.17 Mbps for that scene. Capability-based maximum selection and new
WebRTC spatial adaptation still require deployment and hardware verification;
10 FPS is the observed current mode, not a claim about this camera's maximum.
The final live WebSocket check showed 7.9 FPS at a 10 FPS target and automatic
JPEG quality dropping from 85 to 75 (5.74 Mbps, 37 frames). That verifies client
quality control and fresh metric rendering against the older server; the new
server-side frame-budget correction is not yet running on the rover.

References: [aiortc 1.14.0 sender congestion feedback](https://github.com/aiortc/aiortc/blob/1.14.0/src/aiortc/rtcrtpsender.py),
[aiortc default track timing](https://github.com/aiortc/aiortc/blob/1.14.0/src/aiortc/mediastreams.py),
and [browser inbound RTP metrics](https://developer.mozilla.org/en-US/docs/Web/API/RTCInboundRtpStreamStats).

## WebRTC follow-up

The science camera delivered live 1280x720 video during investigation, so a general
WebRTC outage was not reproduced. Concrete lifecycle defects were found and fixed:

- The client previously reported connected immediately after applying the SDP
  answer. It now waits for the transport's connected event, with a 20 s overall
  connection deadline. SDP, fetch, ICE, timeout, and cancellation failures close
  the local peer; streamless track events are supported.
- Disconnect previously sent a camera-wide DELETE, closing other viewers.
  New backend offer responses include `peer_id`, with additive
  `DELETE .../webrtc/connections/{peer_id}` routes for navigation cameras,
  ROS cameras, and the microscope. Legacy close-all routes remain unchanged.
  The client uses the original host/topic and only that peer's cleanup route.
- Against older deployed backends without `peer_id`, the client closes its own
  transport and relies on server ICE cleanup. It never falls back to close-all.
  Server slots can remain occupied until ICE notices the disconnect; deploying
  the backend changes enables prompt per-viewer cleanup.
- Existing connected viewers are no longer forced out when the source reaches
  five viewers. The server still rejects excess new offers.
- Mode changes clear retry timers, and stale/cancelled negotiation callbacks
  cannot restart a stream or overwrite a replacement client.
- Server offer cancellation now unregisters and closes its peer as well.

The shared client now lives in `src/lib/services/webRtcStreamClient.ts`, re-exported
from the existing video service so callers keep their imports. Tests run on the
local Node 25 runtime, which supports native TypeScript stripping.

Verification: 18 frontend tests (10 WebRTC + 8 API connection), 8 backend WebRTC
lifecycle tests, 5 backend resolution tests, Python syntax checks, and the UI
production build pass. Build warnings remain in existing markup and imports.
The backend lifecycle tests exercise the actual functions with fake peers, not
real ICE or HTTP routing. A new-client live stream delivered 1280x720 video with
`readyState=4`, advancing playback time, and a single transport-connected event.
Switching WebRTC to WebSocket removed the video peer; switching back restored
1280x720 playback (`readyState=4`, playback time 9.745 s at the final check).

Backend WebRTC changes are local only, not deployed. No claim is made that the
new per-viewer routes were exercised on the rover. Multiple native readers of one
OpenCV capture, capture timeouts, ROS topic selection, and stream acquisition by
multiple fullscreen slots remain separate concerns; camera threading was not
redesigned in this pass.

Protocol references: [browser connection state](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/connectionState)
and [aiortc peer APIs](https://aiortc.readthedocs.io/en/latest/api.html).

## Applied corrections and verification

The user subsequently authorized frontend and backend corrections. Both repositories
are now on `codex/debug-camera-detection`. Changes remain uncommitted.

- The API service, store, and form share `DEFAULT_API_URL` (`192.168.1.3:6767`).
- Automatic and manual connections configure the service and URL store before
  publishing connected status. Manual health checks now have a 5 s client timeout.
- Superseded health-check responses cannot overwrite a newer connection or undo
  a disconnect. Manual connection suppresses the delayed startup attempt.
- The missing backend `get_supported_resolutions` method was restored verbatim
  from HEAD. All other pre-existing camera edits were preserved; no threading,
  locking, OpenCV ownership, or public route redesign was made.

Verification after changes:

- `npm test`: 8 passing tests using the actual store/service with mocked fetch.
- `npm run build`: passed, with warnings in unchanged components (including
  accessibility and deprecated Svelte syntax) and the adapter-auto deployment notice.
- `python -m unittest discover -s tests -p test_camera_resolutions.py -v` in the
  backend: 5 passing tests. These compile the actual manager class from its AST
  and mock device existence/v4l2-ctl, avoiding Linux-only application imports.
- `python -m py_compile app/api/navigation/camera.py`: passed.
- `git diff --check`: passed in both repositories.
- Live browser fresh reload: auto-connected, listed `science` at 1280x720/30 FPS,
  showed ROS connected, and enabled Detect without manual reconnect.
- Live browser repeat Detect: still listed `science` and retained ROS connected.
- Live resolutions GET returned HTTP 500 in 0.012575 s before the local backend
  restoration. The UI uses its existing fallback list. The backend correction
  has NOT been deployed, so that live endpoint is not yet verified as repaired.

UI changes: `src/lib/services/roverApi.js`, `src/lib/stores/apiStore.js`,
`src/lib/components/panels/ConnectionPanel.svelte`, `package.json`, and
`tests/apiConnection.test.js`. Backend changes for this task: restoration of one
method in `app/api/navigation/camera.py` and `tests/test_camera_resolutions.py`.

## Initial diagnostic pass (before corrections)

Debug first; no threading/process redesign. No application code was changed.
UI branch: `codex/debug-camera-detection`.
The existing uncommitted backend edits in `app/api/navigation/camera.py` were left untouched.
The dev server was started with `npm run dev` at http://localhost:5174/ because port 5173 was occupied.

## Confirmed connection defect

`src/lib/stores/apiStore.js` auto-connects by fetching
`http://192.168.1.3:6767/api/status` and publishes the connected status, but never
calls `setApiBaseUrl`. The request service in `src/lib/services/roverApi.js`
still has its separate default of `http://10.103.111.189:6767`.

Consequently the connected badge and camera/ROS requests refer to different hosts.
`src/lib/components/panels/ConnectionPanel.svelte` calls `setApiBaseUrl` only after
a successful manual connection. This explains why disconnect/reconnect restores
ROS status without reconnecting the ROS bridge itself.

### Live evidence

- On a fresh page the UI auto-connected to `192.168.1.3`, while camera detection
  showed a spinner and ROS showed disconnected. Browser logs reported failed
  fetches for camera detection and ROS status.
- Direct GET `192.168.1.3:6767/api/status`: HTTP 200 in 0.006844 s,
  `ros_bridge: connected`.
- Direct GET `192.168.1.3:6767/api/ros/status`: HTTP 200 in 0.006885 s,
  `connected: true`, URL `ws://localhost:9090`.
- Direct GET `10.103.111.189:6767/api/status`: no response within the 5 s
  client timeout.
- After manual UI disconnect/reconnect, ROS displayed connected without clicking
  Connect to ROS. The original camera card still displayed its detection spinner.
- Direct GET `192.168.1.3:6767/api/nav/cameras/detect`: HTTP 200 in 0.008809 s,
  one active `science` camera, `/dev/camera-science`, V4L2, 1280x720 at 30 FPS.
- Opening fullscreen after reconnect issued a fresh detection request and offered
  `science` in the camera selector. No stream was started or stopped by this test.

### Source-level reproduction

The actual API service and API store were run in Node with mocked successful
HTTP responses (only the store import aliases were resolved for Node). After
`autoConnect()`, `detectCameras()`, and `getRosStatus()`, the recorded requests were:

```text
http://192.168.1.3:6767/api/status
http://10.103.111.189:6767/api/nav/cameras/detect?max_cameras=10
http://10.103.111.189:6767/api/ros/status
```

The service base URL remained `http://10.103.111.189:6767`. This reproduction uses
mocked transport to isolate URL selection; the separate live checks above verify
actual rover reachability and detection.

## Correction proposed during initial diagnosis

Centralize connection setup: update the request service base URL and URL store
before publishing `apiStatus = connected`, for both automatic and manual
connections. Use one shared default instead of separate defaults.

Manual connection currently publishes connected before the component updates
the service URL, so dependent effects can run with the previous address. Also
consider cancellation/timeouts and ignoring stale results when the connection
changes; the current request helper has no timeout and changing its URL does not
retarget already-issued requests.

The supplied context originally excluded frontend modifications. The user later
authorized those changes; the connection correction is now applied as described above.
Cancellation of old camera/ROS requests and broader request timeouts remain separate
hardening work; the connection-attempt guard only covers connection health checks.

## Separate backend findings and limits

These are source findings, not proof of the historical hardware failure:

- The local detection route is async but calls synchronous OpenCV operations
  directly. A blocked native call could block the event loop. Direct opens appear
  in `_open_camera` and the named/generic detection paths; `capture_frame` calls
  `.read()` directly. Property access and release are also unbounded.
- The existing local debug rewrite had removed `get_supported_resolutions`, but
  the resolutions route still called it. The method is now restored locally.
  The live HTTP 500 is consistent with this regression, but a server traceback
  was not retrieved to prove that the deployed error has the same cause.
- Several routes write a hard-coded debug log under
  `/home/administratror/DEBUG_CAMS_CSRAL` before doing their work. A missing or
  unwritable directory would fail the request. Its existence on the rover was
  not checked.
- The provided thread dumps show the Python main thread in `ep_poll` at the
  sampled instant; they do not prove a stuck OpenCV call.
- The successful live detection reused an already-active science camera. It
  does not test cold-opening hardware, other cameras, stream reads, or the
  reported 10–15 minute recovery condition.
- The deployed backend revision was not established. Do not assume the running
  rover has exactly the same code as the local uncommitted rewrite.

No backend deployment, service restart, camera restart, lock change, or process
isolation change was performed. Application checks and their limits are listed
in the verification section above. The intermittent native hardware failure
remains unproven; fixing URL selection does not establish a killable OpenCV timeout.
# 2026-08-27: black WebRTC stream after backend deployment

The 18:30 screenshot shows an active science camera but a negotiation retry and
no received FPS. SSH inspection of the current API process (started 18:27:28)
and its journal confirmed repeated unresolved browser `.local` ICE candidates,
`Components {1} have no candidate pairs`, and SDP answers with **zero** ICE
candidates. HTTP 200 was therefore not evidence of a usable video connection.
The viewer-specific status returned 1/5 connections during inspection.

The installed aiortc 1.14.0 / aioice 0.10.2 source explains the failure:
`add_remote_candidate(None)` prunes components with no resolved candidates
before `gather_candidates()` runs. Independent gathering successfully found
192.168.1.3, so the rover does have a usable network interface. The reason mDNS
resolution itself fails on this LAN has not been established.

An isolated two-peer test on the rover reproduced zero answer candidates and a
failed connection with an unresolvable mDNS-only offer. Deferring the offer's
end-of-candidates marker allowed one host candidate and connected both peers;
incoming ICE checks supply the peer-reflexive address. No browser privacy
settings or candidate addresses were changed.

Local fixes on `codex/debug-camera-detection`:

- Backend `webrtc_signaling.py` defers end-of-candidates only in media sections
  whose advertised candidates are all `.local`; numeric/mixed offers stay intact.
- `webrtc_utils.py` rejects empty answers and expires unconnected peers after
  30 seconds, releasing abandoned viewer slots.
- CameraPanel shows connecting, failed, or waiting for frames until actual
  connected video metrics justify LIVE. It retains the real retry error and
  prevents duplicate starts from allocating extra viewers.

Verification: 52 UI tests pass. Backend discovery passes 30 tests locally and
skips the native integration test because aiortc is absent on Windows. That
native test passes separately against the patched source in a temporary rover
directory: real ICE/RTP connection, three synthetic frames, target 24 FPS,
and peer-specific cleanup. It does not test physical-camera FPS or the user's
browser. Temporary test files and peers were cleaned up. No running API source
was replaced and no service or dev server was started/restarted for this check.

The notes below describe earlier stages and their verification limits.
