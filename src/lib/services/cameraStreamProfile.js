export const MAX_STREAM_FPS = 60;

/** Select the fastest advertised pixel format at the requested resolution. */
export function selectCameraMode(formats, width, height, fallbackFps = 30) {
    const modes = (formats ?? []).flatMap(format => (format.resolutions ?? [])
        .filter(size => size.width === width && size.height === height)
        .flatMap(size => (size.frame_rates ?? []).map(fps => ({ fps, pixelFormat: format.fourcc }))));
    const valid = modes.filter(mode => Number.isFinite(mode.fps) && mode.fps > 0 && /^[A-Z0-9]{4}$/.test(mode.pixelFormat));
    valid.sort((a, b) => b.fps - a.fps);
    // Prefer an actually advertised rate within the transport limit.
    const best = valid.find(mode => mode.fps <= MAX_STREAM_FPS + 0.1) ?? valid[0];
    const fallback = Number.isFinite(fallbackFps) && fallbackFps > 0 ? fallbackFps : 30;
    // Existing stream APIs use integer rates: 29.97/59.94 are nominal 30/60.
    return {
        fps: Math.max(1, Math.min(MAX_STREAM_FPS, Math.round(best?.fps ?? fallback))),
        pixelFormat: best?.pixelFormat,
        advertisedFps: best?.fps ?? null,
        verified: !!best,
    };
}
