// Handles webcam capture, file upload, and square crop selection for the
// player's "enemy face" photo. Produces a square data-URL used as the
// enemy sprite texture.

export class FaceCapture {
  constructor({ stageEl, videoEl, canvasEl, imgEl, overlayEl, boxEl }) {
    this.stageEl = stageEl;
    this.videoEl = videoEl;
    this.canvasEl = canvasEl;
    this.imgEl = imgEl;
    this.overlayEl = overlayEl;
    this.boxEl = boxEl;
    this.stream = null;
    this._box = null; // {x,y,size} in overlay-local px
    this._drag = null;
    this._bindCropDrag();
  }

  async openCamera(facingMode = "user") {
    this.stopCamera();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
  }

  stopCamera() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
  }

  /** Grabs the current video frame (mirrored to match the live preview) into capture-img. */
  takePhoto() {
    const v = this.videoEl;
    const size = Math.min(v.videoWidth, v.videoHeight);
    this.canvasEl.width = size;
    this.canvasEl.height = size;
    const ctx = this.canvasEl.getContext("2d");
    const sx = (v.videoWidth - size) / 2;
    const sy = (v.videoHeight - size) / 2;
    ctx.save();
    ctx.translate(size, 0);
    ctx.scale(-1, 1); // match the mirrored preview
    ctx.drawImage(v, sx, sy, size, size, 0, 0, size, size);
    ctx.restore();
    this.stopCamera();
    return new Promise((resolve) => {
      this.imgEl.onload = () => resolve();
      this.imgEl.src = this.canvasEl.toDataURL("image/png");
    });
  }

  loadFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        this.imgEl.onload = () => resolve();
        this.imgEl.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /** Centers a default square crop box over the currently shown image. */
  resetCrop() {
    const rect = this._imgRect();
    const size = Math.min(rect.width, rect.height) * 0.7;
    this._box = {
      x: rect.left - this._overlayRect().left + (rect.width - size) / 2,
      y: rect.top - this._overlayRect().top + (rect.height - size) / 2,
      size,
    };
    this._renderBox();
  }

  _imgRect() {
    return this.imgEl.getBoundingClientRect();
  }
  _overlayRect() {
    return this.overlayEl.getBoundingClientRect();
  }

  _renderBox() {
    if (!this._box) return;
    this.boxEl.style.left = `${this._box.x}px`;
    this.boxEl.style.top = `${this._box.y}px`;
    this.boxEl.style.width = `${this._box.size}px`;
    this.boxEl.style.height = `${this._box.size}px`;
  }

  _bindCropDrag() {
    const start = (clientX, clientY) => {
      const oRect = this._overlayRect();
      const iRect = this._imgRect();
      const localX = clientX - oRect.left;
      const localY = clientY - oRect.top;
      const insideBox =
        this._box &&
        localX >= this._box.x &&
        localX <= this._box.x + this._box.size &&
        localY >= this._box.y &&
        localY <= this._box.y + this._box.size;
      this._drag = {
        mode: insideBox ? "move" : "draw",
        startX: localX,
        startY: localY,
        origBox: this._box ? { ...this._box } : null,
        imgLocal: {
          left: iRect.left - oRect.left,
          top: iRect.top - oRect.top,
          width: iRect.width,
          height: iRect.height,
        },
      };
    };
    const move = (clientX, clientY) => {
      if (!this._drag) return;
      const oRect = this._overlayRect();
      const localX = clientX - oRect.left;
      const localY = clientY - oRect.top;
      const img = this._drag.imgLocal;
      if (this._drag.mode === "draw") {
        const dx = localX - this._drag.startX;
        const dy = localY - this._drag.startY;
        let size = Math.max(20, Math.max(Math.abs(dx), Math.abs(dy)));
        size = Math.min(size, img.width, img.height);
        let x = dx >= 0 ? this._drag.startX : this._drag.startX - size;
        let y = dy >= 0 ? this._drag.startY : this._drag.startY - size;
        x = Math.min(Math.max(x, img.left), img.left + img.width - size);
        y = Math.min(Math.max(y, img.top), img.top + img.height - size);
        this._box = { x, y, size };
      } else {
        const dx = localX - this._drag.startX;
        const dy = localY - this._drag.startY;
        const size = this._drag.origBox.size;
        let x = this._drag.origBox.x + dx;
        let y = this._drag.origBox.y + dy;
        x = Math.min(Math.max(x, img.left), img.left + img.width - size);
        y = Math.min(Math.max(y, img.top), img.top + img.height - size);
        this._box = { x, y, size };
      }
      this._renderBox();
    };
    const end = () => {
      this._drag = null;
    };

    this.overlayEl.addEventListener("pointerdown", (e) => {
      this.overlayEl.setPointerCapture(e.pointerId);
      start(e.clientX, e.clientY);
    });
    this.overlayEl.addEventListener("pointermove", (e) => move(e.clientX, e.clientY));
    this.overlayEl.addEventListener("pointerup", end);
    this.overlayEl.addEventListener("pointercancel", end);
  }

  /**
   * Crops the current image to the selected region, masked to a face-shaped
   * oval (transparent outside it) instead of a plain square, and returns a
   * size x size data URL. The oval mask is what makes the enemy sprite read
   * as a "target" cutout rather than a square photo.
   */
  confirmCrop(outputSize = 256) {
    const iRect = this._imgRect();
    const oRect = this._overlayRect();
    const boxImgLocalX = this._box.x - (iRect.left - oRect.left);
    const boxImgLocalY = this._box.y - (iRect.top - oRect.top);
    const scaleX = this.imgEl.naturalWidth / iRect.width;
    const scaleY = this.imgEl.naturalHeight / iRect.height;

    const sx = boxImgLocalX * scaleX;
    const sy = boxImgLocalY * scaleY;
    const ssize = this._box.size * scaleX;

    const out = document.createElement("canvas");
    out.width = outputSize;
    out.height = outputSize;
    const ctx = out.getContext("2d");
    ctx.save();
    ctx.beginPath();
    const cx = outputSize / 2;
    const cy = outputSize / 2;
    ctx.ellipse(cx, cy, outputSize * 0.42, outputSize * 0.48, 0, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this.imgEl, sx, sy, ssize, ssize, 0, 0, outputSize, outputSize);
    ctx.restore();
    return out.toDataURL("image/png");
  }
}
