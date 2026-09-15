/** Independent quality-first control for each camera's JPEG WebSocket stream. */
export class JpegQualityController {
    constructor(quality = 85) { this.quality = quality; this.bad = 0; this.good = 0; }
    update(fps, target) {
        this.bad = fps < target * 0.8 ? this.bad + 1 : 0;
        this.good = fps >= target * 0.9 ? this.good + 1 : 0;
        if (this.bad >= 3) {
            this.quality = Math.max(35, this.quality - 10);
            this.bad = this.good = 0;
        } else if (this.good >= 6) {
            this.quality = Math.min(90, this.quality + 5);
            this.bad = this.good = 0;
        }
        return this.quality;
    }
}
