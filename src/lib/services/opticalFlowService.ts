import cvModule from '@techstark/opencv-js';

interface FlowPoint {
    x: number;
    y: number;
    dx: number;
    dy: number;
}

interface CameraFlowState {
    video: HTMLVideoElement;
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    previousGray: any | null;
    previousPoints: any | null;

    running: boolean;
    frameCount: number;
    lastTimestamp: number;
}

export interface OpticalFlowResult {
    cameraName: string;

    frameCount: number;
    trackedPoints: number;

    meanDx: number;
    meanDy: number;

    meanMagnitude: number;

    topMeanDy: number;
    middleMeanDy: number;
    bottomMeanDy: number;

    points: FlowPoint[];
}

export class OpticalFlowService {
    private cv: any = null;

    private readonly processingWidth = 320;
    private readonly processingHeight = 240;

    private readonly states = new Map<string, CameraFlowState>();

    /**
     * Initialize OpenCV.js.
     */
    async initialize(): Promise<void> {
        const start = Date.now();

        try {
            if (cvModule instanceof Promise) {
                this.cv = await cvModule;
            } else if (cvModule && cvModule.Mat) {
                this.cv = cvModule;
            } else {
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(
                            new Error(
                                '[OpticalFlow] OpenCV.js initialization timed out'
                            )
                        );
                    }, 10000);

                    cvModule.onRuntimeInitialized = () => {
                        clearTimeout(timeout);
                        resolve();
                    };
                });

                this.cv = cvModule;
            }

            if (!this.cv || !this.cv.Mat) {
                throw new Error(
                    '[OpticalFlow] OpenCV initialized but cv.Mat is unavailable'
                );
            }

            console.log(
                `[OpticalFlow] OpenCV.js ready in ${Date.now() - start} ms`
            );

        } catch (error) {
            console.error(
                '[OpticalFlow] Initialization failed:',
                error
            );

            throw error;
        }
    }

    /**
     * Check whether OpenCV.js is ready.
     */
    isReady(): boolean {
        return this.cv !== null && !!this.cv.Mat;
    }

    /**
     * Get the OpenCV instance.
     */
    getCV(): any {
        if (!this.isReady()) {
            throw new Error(
                '[OpticalFlow] OpenCV.js is not initialized'
            );
        }

        return this.cv;
    }

    /**
     * Start optical-flow processing for one camera.
     *
     * The original video element is never modified.
     * Frames are copied into a hidden/reduced-resolution canvas.
     */
    start(
        cameraName: string,
        video: HTMLVideoElement,
        onResult?: (result: OpticalFlowResult) => void
    ): void {
        if (!this.isReady()) {
            throw new Error(
                '[OpticalFlow] Call initialize() before start()'
            );
        }

        if (this.states.has(cameraName)) {
            console.warn(
                `[OpticalFlow] ${cameraName} is already running`
            );
            return;
        }

        const canvas = document.createElement('canvas');

        canvas.width = this.processingWidth;
        canvas.height = this.processingHeight;

        const ctx = canvas.getContext('2d', {
            willReadFrequently: true
        });

        if (!ctx) {
            throw new Error(
                `[OpticalFlow] Could not create canvas context for ${cameraName}`
            );
        }

        const state: CameraFlowState = {
            video,
            canvas,
            ctx,

            previousGray: null,
            previousPoints: null,

            running: true,
            frameCount: 0,
            lastTimestamp: 0
        };

        this.states.set(cameraName, state);

        console.log(
            `[OpticalFlow] Started processing: ${cameraName}`
        );

        const processFrame = (
            _now: DOMHighResTimeStamp,
            metadata: VideoFrameCallbackMetadata
        ) => {
            if (!state.running) {
                return;
            }

            if (
                video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
                video.videoWidth > 0 &&
                video.videoHeight > 0
            ) {
                try {
                    const result = this.processFrame(
                        cameraName,
                        state,
                        metadata.mediaTime
                    );

                    if (result && onResult) {
                        onResult(result);
                    }
                } catch (error) {
                    console.error(
                        `[OpticalFlow] Frame processing error (${cameraName}):`,
                        error
                    );
                }
            }

            if (
                state.running &&
                'requestVideoFrameCallback' in video
            ) {
                video.requestVideoFrameCallback(processFrame);
            }
        };

        if ('requestVideoFrameCallback' in video) {
            video.requestVideoFrameCallback(processFrame);
        } else {
            console.warn(
                `[OpticalFlow] requestVideoFrameCallback is not available for ${cameraName}`
            );
        }
    }

    /**
     * Stop processing for one camera.
     */
    stop(cameraName: string): void {
        const state = this.states.get(cameraName);

        if (!state) {
            return;
        }

        state.running = false;

        this.releaseState(state);

        this.states.delete(cameraName);

        console.log(
            `[OpticalFlow] Stopped processing: ${cameraName}`
        );
    }

    /**
     * Stop every camera.
     */
    stopAll(): void {
        for (const cameraName of this.states.keys()) {
            this.stop(cameraName);
        }
    }

    /**
     * Process one decoded video frame.
     */
    private processFrame(
        cameraName: string,
        state: CameraFlowState,
        mediaTime: number
    ): OpticalFlowResult | null {
        const cv = this.getCV();

        state.frameCount++;
        state.lastTimestamp = mediaTime;

        // Copy the WebRTC video frame into the reduced-resolution canvas.
        state.ctx.drawImage(
            state.video,
            0,
            0,
            this.processingWidth,
            this.processingHeight
        );

        const imageData = state.ctx.getImageData(
            0,
            0,
            this.processingWidth,
            this.processingHeight
        );

        const pixels = imageData.data;

        let minBrightness = 255;
        let maxBrightness = 0;
        let brightnessSum = 0;

        for (let i = 0; i < pixels.length; i += 4) {
            const brightness =
                0.299 * pixels[i] +
                0.587 * pixels[i + 1] +
                0.114 * pixels[i + 2];

            minBrightness = Math.min(
                minBrightness,
                brightness
            );

            maxBrightness = Math.max(
                maxBrightness,
                brightness
            );

            brightnessSum += brightness;
        }

        const pixelCount = pixels.length / 4;

        const meanBrightness =
            brightnessSum / pixelCount;

        if (state.frameCount <= 3) {
            console.log(
                '[OpticalFlow] Frame brightness:',
                {
                    min: minBrightness,
                    max: maxBrightness,
                    mean: meanBrightness
                }
            );
        }

        const rgba = cv.matFromImageData(imageData);

        const gray = new cv.Mat();

        cv.cvtColor(
            rgba,
            gray,
            cv.COLOR_RGBA2GRAY
        );

        rgba.delete();

        // First frame, or no usable features:
        // detect features but cannot calculate motion yet.
        if (
            !state.previousGray ||
            !state.previousPoints ||
            state.previousPoints.rows === 0
        ) {
            // Release the previous empty point matrix.
            if (state.previousPoints) {
                state.previousPoints.delete();
                state.previousPoints = null;
            }

            // Release the previous grayscale frame before replacing it.
            if (state.previousGray) {
                state.previousGray.delete();
                state.previousGray = null;
            }

            const points = this.detectFeatures(gray);

            state.previousGray = gray;
            state.previousPoints = points;

            return null;
        }

        const nextPoints = new cv.Mat();
        const status = new cv.Mat();
        const error = new cv.Mat();

        const backwardPoints = new cv.Mat();
        const backwardStatus = new cv.Mat();
        const backwardError = new cv.Mat();

        const winSize = new cv.Size(21, 21);

        const maxLevel = 3;

        const criteria = new cv.TermCriteria(
            cv.TERM_CRITERIA_EPS | cv.TERM_CRITERIA_COUNT,
            30,
            0.01
        );

        cv.calcOpticalFlowPyrLK(
            state.previousGray,
            gray,
            state.previousPoints,
            nextPoints,
            status,
            error,
            winSize,
            maxLevel,
            criteria
        );

        // Track the points backwards from the current frame
        // to the previous frame.
        cv.calcOpticalFlowPyrLK(
            gray,
            state.previousGray,
            nextPoints,
            backwardPoints,
            backwardStatus,
            backwardError,
            winSize,
            maxLevel,
            criteria
        );

        const points: FlowPoint[] = [];

        /*const topDy: number[] = [];
        const middleDy: number[] = [];
        const bottomDy: number[] = [];

        let totalDx = 0;
        let totalDy = 0;
        let totalMagnitude = 0;*/

        for (
            let i = 0;
            i < state.previousPoints.rows;
            i++
        ) {
            const forwardValid =
                status.ucharAt(i, 0);

            const backwardValid =
                backwardStatus.ucharAt(i, 0);

            if (!forwardValid || !backwardValid) {
                continue;
            }

            const oldX =
                state.previousPoints.floatAt(i, 0);

            const oldY =
                state.previousPoints.floatAt(i, 1);

            const newX =
                nextPoints.floatAt(i, 0);

            const newY =
                nextPoints.floatAt(i, 1);

            const backX =
                backwardPoints.floatAt(i, 0);

            const backY =
                backwardPoints.floatAt(i, 1);

            // Forward-backward tracking error.
            const fbDx = oldX - backX;
            const fbDy = oldY - backY;

            const fbError = Math.sqrt(
                fbDx * fbDx +
                fbDy * fbDy
            );

            // Reject unreliable tracks.
            if (fbError > 1.5) {
                continue;
            }

            const dx = newX - oldX;
            const dy = newY - oldY;

            const magnitude = Math.sqrt(
                dx * dx +
                dy * dy
            );

            if (
                !Number.isFinite(dx) ||
                !Number.isFinite(dy)
            ) {
                continue;
            }

            if (magnitude > 50) {
                continue;
            }

            points.push({
                x: newX,
                y: newY,
                dx,
                dy
            });
    }


        // ============================================================
        // ROBUST MOTION OUTLIER FILTER
        // ============================================================

        const dxValues = points.map(
            point => point.dx
        );

        const dyValues = points.map(
            point => point.dy
        );

        const medianDx =
            this.median(dxValues);

        const medianDy =
            this.median(dyValues);

        const madDx =
            this.medianAbsoluteDeviation(
                dxValues,
                medianDx
            );

        const madDy =
            this.medianAbsoluteDeviation(
                dyValues,
                medianDy
            );

        const robustDxThreshold =
            Math.max(
                3 * madDx,
                1.0
            );

        const robustDyThreshold =
            Math.max(
                3 * madDy,
                1.0
            );

        const filteredPoints =
            points.filter(point =>
                Math.abs(point.dx - medianDx)
                    <= robustDxThreshold &&
                Math.abs(point.dy - medianDy)
                    <= robustDyThreshold
            );


        const detectedCandidatePoints =
            points.length;

        const trackedPoints =
            filteredPoints.length;

        const totalDetectedPoints =
            state.previousPoints.rows;

        const trackingRetention =
            totalDetectedPoints > 0
                ? trackedPoints / totalDetectedPoints
                : 0;

        const robustRetention =
            detectedCandidatePoints > 0
                ? trackedPoints / detectedCandidatePoints
                : 0;

        if (state.frameCount % 30 === 0) {
            console.log(
                '[OpticalFlow] Tracking quality:',
                {
                    detected: totalDetectedPoints,
                    fbAccepted: detectedCandidatePoints,
                    robustAccepted: trackedPoints,
                    fbRetention: trackingRetention,
                    robustRetention
                }
            );
        }       

        let totalDx = 0;
        let totalDy = 0;
        let totalMagnitude = 0;

        const topDy: number[] = [];
        const middleDy: number[] = [];
        const bottomDy: number[] = [];

        for (const point of filteredPoints) {
            totalDx += point.dx;
            totalDy += point.dy;

            totalMagnitude += Math.sqrt(
                point.dx * point.dx +
                point.dy * point.dy
            );

            if (
                point.y <
                this.processingHeight / 3
            ) {
                topDy.push(point.dy);
            } else if (
                point.y <
                (2 * this.processingHeight) / 3
            ) {
                middleDy.push(point.dy);
            } else {
                bottomDy.push(point.dy);
            }
        }
        const meanDx =
            trackedPoints > 0
                ? totalDx / trackedPoints
                : 0;

        const meanDy =
            trackedPoints > 0
                ? totalDy / trackedPoints
                : 0;

        const meanMagnitude =
            trackedPoints > 0
                ? totalMagnitude / trackedPoints
                : 0;

        const result: OpticalFlowResult = {
            cameraName,

            frameCount: state.frameCount,
            trackedPoints,

            meanDx,
            meanDy,

            meanMagnitude,

            topMeanDy: this.mean(topDy),
            middleMeanDy: this.mean(middleDy),
            bottomMeanDy: this.mean(bottomDy),

            points
        };

        // Release previous OpenCV objects.
        state.previousGray.delete();
        state.previousPoints.delete();

        // Keep current frame for the next iteration.
        state.previousGray = gray;

        // Use the currently tracked points as the next reference points.
        state.previousPoints = nextPoints;

        status.delete();
        error.delete();

        backwardPoints.delete();
        backwardStatus.delete();
        backwardError.delete();

        // Periodically refresh feature detection.
        if (
            state.frameCount % 30 === 0 ||
            trackedPoints < 30
        ) {
            state.previousPoints.delete();

            state.previousPoints =
                this.detectFeatures(gray);
        }

        return result;
    }

    /**
     * Detect good features for Lucas-Kanade tracking.
     */
    private detectFeatures(gray: any): any {
        const cv = this.getCV();

        const detector = new cv.FastFeatureDetector(
            5,      // lower threshold
            true,   // non-max suppression
            cv.FastFeatureDetector_TYPE_9_16
        );

        const keypoints = new cv.KeyPointVector();

        try {
            detector.detect(gray, keypoints);

            const count = keypoints.size();

            if (count < 10) {
                console.warn(
                    `[OpticalFlow] Low FAST feature count: ${count}`
                );
            }

            if (count === 0) {
                return new cv.Mat();
            }

            const points = new cv.Mat(
                count,
                1,
                cv.CV_32FC2
            );

            const data = points.data32F;

            for (let i = 0; i < count; i++) {
                const keypoint = keypoints.get(i);

                data[i * 2] = keypoint.pt.x;
                data[i * 2 + 1] = keypoint.pt.y;
            }

            /*console.log(
                `[OpticalFlow] FAST detected ${count} features`
            );*/

            return points;
        } finally {
            keypoints.delete();
            detector.delete();
        }
    }

    private median(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }

        const sorted = [...values].sort(
            (a, b) => a - b
        );

        const middle =
            Math.floor(sorted.length / 2);

        if (sorted.length % 2 === 0) {
            return (
                sorted[middle - 1] +
                sorted[middle]
            ) / 2;
        }

        return sorted[middle];
    }

    /**
     * Calculate the median absolute deviation of an array.
     */
    private medianAbsoluteDeviation(
        values: number[],
        medianValue: number
    ): number {
        if (values.length === 0) {
            return 0;
        }

        const deviations = values.map(
            value => Math.abs(value - medianValue)
        );

        return this.median(deviations);
    }
    /**
     * Calculate the arithmetic mean of an array.
     */
    private mean(values: number[]): number {
        if (values.length === 0) {
            return 0;
        }

        let sum = 0;

        for (const value of values) {
            sum += value;
        }

        return sum / values.length;
    }

    /**
     * Release OpenCV resources associated with one camera.
     */
    private releaseState(state: CameraFlowState): void {
        if (state.previousGray) {
            state.previousGray.delete();
            state.previousGray = null;
        }

        if (state.previousPoints) {
            state.previousPoints.delete();
            state.previousPoints = null;
        }
    }
}