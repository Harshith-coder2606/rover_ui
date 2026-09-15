# Driving controls and Android sensor removal

Changes are uncommitted on `codex/debug-camera-detection` in both repositories.

## Operator controls

- Classic is the default and keeps the existing step-based behavior.
- Enable **Game controls** in the Driving Controls panel to use progressive
  WASD acceleration. The ramp starts at 0.15 units/second and its acceleration
  increases by 0.35 units/second each second, capped at 1 unit/second.
  Existing velocity limits remain ±1 m/s and ±1 rad/s; Arduino maps to 0–255.
- Releasing a movement key stops that axis. ROS supports simultaneous movement
  and steering; opposing keys cancel. Arduino retains its single-direction
  protocol, so the newest direction replaces the previous one.
- **L** freezes both speed and direction. Releasing the original movement keys
  does not cancel cruise; another new key press does. OS autorepeat from a key
  already held when locking is ignored. Pressing L again also clears cruise.
- **Space / X / Escape** stop in Game mode. The existing emergency stop remains.
  Arduino's IJKL camera shortcuts remain available in Classic mode; Game mode
  reserves L for cruise lock.
- Mode changes, focus loss, hidden pages, typing focus, connection loss and
  component teardown clear Game motion. Keys held through a stop must be
  released before they can restart movement. A timer gap over 250 ms disarms
  Game motion instead of catching up at a higher speed.

## Transport and safety limits

Game commands publish at up to 10 Hz, with one request in flight and newer
movement replacing queued movement. A queued zero command is preserved before
any subsequent movement. Game requests have a 1-second client timeout; errors
disarm the controls and request an emergency stop without an automatic retry
loop. Toggle Game controls off and on to re-arm after checking the rover.

The lock cancels immediately in local input state. Physical stopping still
depends on request delivery and the motor controller. A browser or network
failure cannot guarantee a stop; use an onboard command watchdog and physical
emergency stop. No hardware watchdog or firmware changes were made here.
Changing API hosts does not redirect queued Game commands to the new rover.

## Android removal

Removed the frontend sensor panel/store/API helpers and backend Android router
module. The module previously started its socket listener at import time, so
removing the router import also removes that startup thread. The live backend
must be updated/restarted to retire its existing endpoints and listener.

## Verification

- 49 frontend tests pass, including pure input/queue tests and the actual
  DrivingControls script handlers run with fake clocks and motor APIs.
- Backend router removal regression and Python compilation pass.
- Production build passes with existing warnings.
- Browser UI inspection checks the toggle and absence of Android Sensors.
- No nonzero commands were sent to the live rover for testing. Handler tests
  do not emulate Svelte's rendering/reactivity or real motor behavior.
