const TRIMMER_REGISTER_FLAG = "__vodcesTrimmerRegistered";

type TrimmerChangePayload = {
  startTime: number;
  endTime: number;
};

type VideoJsPluginConstructor = new (...args: unknown[]) => Record<string, unknown>;

type VideoJsLike = {
  getPlugin: (name: string) => VideoJsPluginConstructor | null | undefined;
  registerPlugin: (name: string, plugin: VideoJsPluginConstructor) => void;
  [key: string]: unknown;
};

export type VideoJsTrimmerInstance = {
  startTime: number;
  endTime: number;
  originalDuration: number;
  setRange: (startTime: number, endTime: number, emitEvent?: boolean) => void;
  updateTrimmer: () => void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function isTouchLikeEvent(event: MouseEvent | TouchEvent): event is TouchEvent {
  return "touches" in event;
}

export function registerVideoJsTrimmer(videojs: VideoJsLike): void {
  if (videojs[TRIMMER_REGISTER_FLAG]) {
    return;
  }

  const BasePlugin = videojs.getPlugin("plugin");
  if (!BasePlugin) {
    return;
  }

  class Trimmer extends BasePlugin {
    player: {
      controlBar?: {
        progressControl?: {
          el: () => HTMLElement | null;
        };
      };
      addClass: (className: string) => void;
      currentTime: (time?: number) => number;
      duration: () => number;
      offset?: (config: { start: number; end: number }) => void;
      on: (eventName: string, handler: (...args: unknown[]) => void) => void;
      trigger: (eventName: string, payload?: TrimmerChangePayload) => void;
    };

    startTime = 0;

    endTime = 0;

    originalDuration = 0;

    trimmerEl: HTMLDivElement | null = null;

    startHandleEl: HTMLDivElement | null = null;

    endHandleEl: HTMLDivElement | null = null;

    markerContainerEl: HTMLDivElement | null = null;

    private draggingStart = false;

    private draggingEnd = false;

    private readonly onPointerMoveBound: (event: MouseEvent | TouchEvent) => void;

    private readonly onPointerUpBound: () => void;

    constructor(player: Trimmer["player"], options: unknown) {
      super(player, options);
      this.player = player;

      this.onPointerMoveBound = (event) => {
        this.onPointerMove(event);
      };
      this.onPointerUpBound = () => {
        this.onPointerUp();
      };

      this.createTrimmer();
      this.player.addClass("video-js-trimmer");

      this.player.on("loadedmetadata", () => {
        const duration = this.player.duration();
        if (!Number.isFinite(duration) || duration <= 0) {
          return;
        }

        this.originalDuration = duration;
        this.setRange(this.startTime, this.endTime > 0 ? this.endTime : duration, false);
        this.createTimeMarkers();
      });
    }

    private getProgressControlElement(): HTMLElement | null {
      return this.player.controlBar?.progressControl?.el?.() ?? null;
    }

    private createTrimmer(): void {
      const progressControlEl = this.getProgressControlElement();
      if (!progressControlEl) {
        return;
      }

      this.trimmerEl = document.createElement("div");
      this.trimmerEl.className = "vjs-trimmer";
      progressControlEl.appendChild(this.trimmerEl);

      this.startHandleEl = document.createElement("div");
      this.startHandleEl.className = "vjs-trimmer-handle start";
      progressControlEl.appendChild(this.startHandleEl);

      this.endHandleEl = document.createElement("div");
      this.endHandleEl.className = "vjs-trimmer-handle end";
      progressControlEl.appendChild(this.endHandleEl);

      this.startHandleEl.addEventListener("mousedown", this.onStartHandleDown);
      this.startHandleEl.addEventListener("touchstart", this.onStartHandleDown, {
        passive: false,
      });
      this.endHandleEl.addEventListener("mousedown", this.onEndHandleDown);
      this.endHandleEl.addEventListener("touchstart", this.onEndHandleDown, {
        passive: false,
      });

      this.updateTrimmer();
    }

    private createTimeMarkers(): void {
      const progressControlEl = this.getProgressControlElement();
      if (!progressControlEl) {
        return;
      }

      if (this.markerContainerEl) {
        this.markerContainerEl.remove();
      }

      const markerContainer = document.createElement("div");
      markerContainer.className = "vjs-time-markers";

      const markerCount = 12;
      for (let i = 0; i <= markerCount; i += 1) {
        const marker = document.createElement("div");
        marker.className = "vjs-time-marker";
        marker.style.left = `${(i / markerCount) * 100}%`;

        const timeLabel = document.createElement("span");
        timeLabel.className = "vjs-time-label";

        const seconds = (i / markerCount) * this.originalDuration;
        timeLabel.textContent = this.formatTime(seconds);

        marker.appendChild(timeLabel);
        markerContainer.appendChild(marker);
      }

      progressControlEl.appendChild(markerContainer);
      this.markerContainerEl = markerContainer;
    }

    private readonly onStartHandleDown = (event: MouseEvent | TouchEvent): void => {
      event.preventDefault();
      this.draggingStart = true;
      this.attachPointerListeners();
    };

    private readonly onEndHandleDown = (event: MouseEvent | TouchEvent): void => {
      event.preventDefault();
      this.draggingEnd = true;
      this.attachPointerListeners();
    };

    private attachPointerListeners(): void {
      document.addEventListener("mousemove", this.onPointerMoveBound);
      document.addEventListener("mouseup", this.onPointerUpBound);
      document.addEventListener("touchmove", this.onPointerMoveBound, {
        passive: false,
      });
      document.addEventListener("touchend", this.onPointerUpBound);
      document.addEventListener("touchcancel", this.onPointerUpBound);
    }

    private detachPointerListeners(): void {
      document.removeEventListener("mousemove", this.onPointerMoveBound);
      document.removeEventListener("mouseup", this.onPointerUpBound);
      document.removeEventListener("touchmove", this.onPointerMoveBound);
      document.removeEventListener("touchend", this.onPointerUpBound);
      document.removeEventListener("touchcancel", this.onPointerUpBound);
    }

    private onPointerMove(event: MouseEvent | TouchEvent): void {
      const progressControlEl = this.getProgressControlElement();
      if (!progressControlEl || this.originalDuration <= 0) {
        return;
      }

      if (isTouchLikeEvent(event)) {
        event.preventDefault();
      }

      const clientX =
        isTouchLikeEvent(event) ? event.touches[0]?.clientX ?? 0 : event.clientX;
      const rect = progressControlEl.getBoundingClientRect();
      const relativeX = clamp(clientX - rect.left, 0, rect.width);
      const nextTime = (relativeX / rect.width) * this.originalDuration;

      if (this.draggingStart) {
        this.startTime = clamp(nextTime, 0, Math.max(0, this.endTime - 0.5));
      } else if (this.draggingEnd) {
        this.endTime = clamp(nextTime, Math.min(this.startTime + 0.5, this.originalDuration), this.originalDuration);
      }

      this.updateTrimmer();
      this.player.trigger("trimmerchange", {
        startTime: this.startTime,
        endTime: this.endTime,
      });
    }

    private onPointerUp(): void {
      this.draggingStart = false;
      this.draggingEnd = false;
      this.detachPointerListeners();
    }

    private formatTime(totalSeconds: number): string {
      const safeSeconds = Math.max(0, Math.floor(totalSeconds));
      const minutes = Math.floor(safeSeconds / 60);
      const seconds = safeSeconds % 60;
      return `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    setRange(startTime: number, endTime: number, emitEvent = true): void {
      const duration = this.originalDuration > 0
        ? this.originalDuration
        : Math.max(Number(this.player.duration()) || 0, 1);

      this.originalDuration = duration;

      const safeStart = clamp(startTime, 0, Math.max(0, duration - 1));
      const safeEnd = clamp(endTime, safeStart + 1, duration);

      this.startTime = safeStart;
      this.endTime = safeEnd;

      this.updateTrimmer();

      if (emitEvent) {
        this.player.trigger("trimmerchange", {
          startTime: this.startTime,
          endTime: this.endTime,
        });
      }
    }

    updateTrimmer(): void {
      if (!this.trimmerEl || !this.startHandleEl || !this.endHandleEl || this.originalDuration <= 0) {
        return;
      }

      const startPos = (this.startTime / this.originalDuration) * 100;
      const endPos = (this.endTime / this.originalDuration) * 100;

      this.trimmerEl.style.left = `${startPos}%`;
      this.trimmerEl.style.width = `${Math.max(0, endPos - startPos)}%`;

      this.startHandleEl.style.left = `${startPos}%`;
      this.endHandleEl.style.left = `${endPos}%`;

      if (typeof this.player.offset === "function") {
        this.player.offset({
          start: this.startTime,
          end: this.endTime,
        });
      }
    }
  }

  videojs.registerPlugin("trimmer", Trimmer as unknown as VideoJsPluginConstructor);
  videojs[TRIMMER_REGISTER_FLAG] = true;
}
