/**
 * Pseudo-3D perspective camera. The world is a flat track (x across,
 * y forward); objects can have height h. project() maps to screen pixels.
 */
export interface Projected {
  x: number;
  y: number;
  /** Pixels per world unit at this depth. */
  s: number;
  visible: boolean;
}

export class Camera {
  W = 390;
  H = 844;
  camX = 0;
  camY = 0;
  focal = 900;
  horizon = 0;
  bottom = 0;
  scale0 = 1;
  shakeX = 0;
  shakeY = 0;
  zoom = 1;

  resize(w: number, h: number): void {
    this.W = w;
    this.H = h;
    this.horizon = -0.25 * h;
    this.bottom = 1.05 * h;
    this.scale0 = Math.min((w * 0.5) / 160, (h * 0.34) / 160);
  }

  project(x: number, y: number, h: number, out: Projected): Projected {
    const z = y - this.camY;
    if (z < -this.focal * 0.7) {
      out.visible = false;
      return out;
    }
    const s = this.focal / (this.focal + z);
    const px = this.scale0 * s * this.zoom;
    out.s = px;
    out.x = this.W / 2 + (x - this.camX) * px + this.shakeX;
    const groundY = this.horizon + (this.bottom - this.horizon) * s;
    out.y = this.H / 2 + (groundY - this.H / 2) * this.zoom - h * px + this.shakeY;
    out.visible = true;
    return out;
  }

  /** Depth scale only (cheap) — for culling. */
  depth(y: number): number {
    return y - this.camY;
  }
}
