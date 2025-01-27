import { IS_BROWSER } from '../constants';
import type { Marker } from '../core';
import type { EventType, EventListener, FrameEvent } from '../event-manager';
import { EventManager } from '../event-manager';
import type { Config, Layout, Manifest, Mode, RenderConfig } from '../types';

import type { MethodParamsMap, MethodResultMap, RpcRequest, RpcResponse } from './types';
import { WorkerManager } from './worker-manager';

function getCanvasSize(canvas: HTMLCanvasElement | OffscreenCanvas): { height: number; width: number } {
  if (canvas instanceof OffscreenCanvas) {
    return { width: canvas.width, height: canvas.height };
  }

  const { height, width } = canvas.getBoundingClientRect();

  return { width: width * window.devicePixelRatio, height: height * window.devicePixelRatio };
}

function generateUniqueId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

export interface DotLottieInstanceState {
  activeAnimationId: string | undefined;
  activeThemeId: string | undefined;
  autoplay: boolean;
  backgroundColor: string;
  currentFrame: number;
  duration: number;
  isFrozen: boolean;
  isLoaded: boolean;
  isPaused: boolean;
  isPlaying: boolean;
  isReady: boolean;
  isStopped: boolean;
  layout: Layout | undefined;
  loop: boolean;
  manifest: Manifest | null;
  marker: string | undefined;
  markers: Marker[];
  mode: Mode;
  renderConfig: RenderConfig;
  segment: [number, number] | undefined;
  segmentDuration: number;
  speed: number;
  totalFrames: number;
  useFrameInterpolation: boolean;
}

export class DotLottieWorker {
  private static readonly _workerManager = new WorkerManager();

  private readonly _eventManager = new EventManager();

  private readonly _id: string;

  private readonly _worker: Worker;

  private readonly _canvas: HTMLCanvasElement;

  private _dotLottieInstanceState: DotLottieInstanceState = {
    markers: [],
    autoplay: false,
    backgroundColor: '',
    currentFrame: 0,
    duration: 0,
    loop: false,
    mode: 'forward',
    segment: [0, 0],
    segmentDuration: 0,
    speed: 1,
    totalFrames: 0,
    isLoaded: false,
    isPlaying: false,
    isPaused: false,
    isStopped: true,
    isFrozen: false,
    useFrameInterpolation: false,
    renderConfig: {
      devicePixelRatio: window.devicePixelRatio,
    },
    activeAnimationId: '',
    activeThemeId: '',
    layout: undefined,
    marker: undefined,
    isReady: false,
    manifest: null,
  };

  private static _wasmUrl: string = '';

  private _created: boolean = false;

  public constructor(config: Config & { workerId?: string }) {
    this._canvas = config.canvas;

    this._id = `dotlottie-${generateUniqueId()}`;
    const workerId = config.workerId || 'defaultWorker';

    // creates or gets the worker
    this._worker = DotLottieWorker._workerManager.getWorker(workerId);

    DotLottieWorker._workerManager.assignAnimationToWorker(this._id, workerId);

    if (DotLottieWorker._wasmUrl) {
      this._sendMessage('setWasmUrl', { url: DotLottieWorker._wasmUrl });
    }

    this._create(config);

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    this._worker.addEventListener('message', this._handleWorkerEvent.bind(this));
  }

  private async _handleWorkerEvent(event: MessageEvent): Promise<void> {
    const rpcResponse: RpcResponse<
      | 'onComplete'
      | 'onLoad'
      | 'onDestroy'
      | 'onUnfreeze'
      | 'onFrame'
      | 'onRender'
      | 'onFreeze'
      | 'onPause'
      | 'onPlay'
      | 'onStop'
      | 'onLoadError'
      | 'onReady'
    > = event.data;

    if (!rpcResponse.id) {
      if (rpcResponse.method === 'onLoad' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onComplete' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onDestroy' && rpcResponse.result.instanceId === this._id) {
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onUnfreeze' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._dotLottieInstanceState.isFrozen = false;
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onFrame' && rpcResponse.result.instanceId === this._id) {
        this._dotLottieInstanceState.currentFrame = (rpcResponse.result.event as FrameEvent).currentFrame;
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onRender' && rpcResponse.result.instanceId === this._id) {
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onFreeze' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onPause' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onPlay' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onStop' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onLoadError' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }

      if (rpcResponse.method === 'onReady' && rpcResponse.result.instanceId === this._id) {
        await this._updateDotLottieInstanceState();
        this._eventManager.dispatch(rpcResponse.result.event);
      }
    }
  }

  private async _create(config: Config): Promise<void> {
    let offscreen: OffscreenCanvas;

    if (this._canvas instanceof HTMLCanvasElement) {
      offscreen = this._canvas.transferControlToOffscreen();
    } else {
      offscreen = this._canvas;
    }

    const { instanceId } = await this._sendMessage(
      'create',
      {
        instanceId: this._id,
        config: {
          ...config,
          // @ts-ignore
          canvas: offscreen,
        },
        ...getCanvasSize(this._canvas),
      },
      [offscreen],
    );

    if (instanceId !== this._id) {
      throw new Error('Instance ID mismatch');
    }

    this._created = true;

    await this._updateDotLottieInstanceState();
  }

  public get isLoaded(): boolean {
    return this._dotLottieInstanceState.isLoaded;
  }

  public get isPlaying(): boolean {
    return this._dotLottieInstanceState.isPlaying;
  }

  public get isPaused(): boolean {
    return this._dotLottieInstanceState.isPaused;
  }

  public get isStopped(): boolean {
    return this._dotLottieInstanceState.isStopped;
  }

  public get currentFrame(): number {
    return this._dotLottieInstanceState.currentFrame;
  }

  public get isFrozen(): boolean {
    return this._dotLottieInstanceState.isFrozen;
  }

  public get segmentDuration(): number {
    return this._dotLottieInstanceState.segmentDuration;
  }

  public get totalFrames(): number {
    return this._dotLottieInstanceState.totalFrames;
  }

  public get segment(): [number, number] | undefined {
    return this._dotLottieInstanceState.segment;
  }

  public get speed(): number {
    return this._dotLottieInstanceState.speed;
  }

  public get duration(): number {
    return this._dotLottieInstanceState.duration;
  }

  public get isReady(): boolean {
    return this._dotLottieInstanceState.isReady;
  }

  public get mode(): Mode {
    return this._dotLottieInstanceState.mode;
  }

  public get canvas(): HTMLCanvasElement | null {
    return this._canvas;
  }

  public get autoplay(): boolean {
    return this._dotLottieInstanceState.autoplay;
  }

  public get backgroundColor(): string {
    return this._dotLottieInstanceState.backgroundColor;
  }

  public get loop(): boolean {
    return this._dotLottieInstanceState.loop;
  }

  public get useFrameInterpolation(): boolean {
    return this._dotLottieInstanceState.useFrameInterpolation;
  }

  public get renderConfig(): RenderConfig {
    return this._dotLottieInstanceState.renderConfig;
  }

  public get manifest(): Manifest | null {
    return this._dotLottieInstanceState.manifest;
  }

  public get activeAnimationId(): string | undefined {
    return this._dotLottieInstanceState.activeAnimationId;
  }

  public get marker(): string | undefined {
    return this._dotLottieInstanceState.marker;
  }

  public get activeThemeId(): string | undefined {
    return this._dotLottieInstanceState.activeThemeId;
  }

  public get layout(): Layout | undefined {
    return this._dotLottieInstanceState.layout;
  }

  public async play(): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('play', { instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async pause(): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('pause', { instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async stop(): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('stop', { instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async setSpeed(speed: number): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setSpeed', { instanceId: this._id, speed });
    await this._updateDotLottieInstanceState();
  }

  public async setMode(mode: Mode): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setMode', { instanceId: this._id, mode });
    await this._updateDotLottieInstanceState();
  }

  public async setFrame(frame: number): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setFrame', { frame, instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async setSegment(start: number, end: number): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setSegment', { instanceId: this._id, segment: [start, end] });
    await this._updateDotLottieInstanceState();
  }

  public async setRenderConfig(renderConfig: RenderConfig): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setRenderConfig', { instanceId: this._id, renderConfig });
    await this._updateDotLottieInstanceState();
  }

  public async setUseFrameInterpolation(useFrameInterpolation: boolean): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setUseFrameInterpolation', { instanceId: this._id, useFrameInterpolation });
    await this._updateDotLottieInstanceState();
  }

  public async loadTheme(themeId: string): Promise<boolean> {
    if (!this._created) return false;

    const result = this._sendMessage('loadTheme', { instanceId: this._id, themeId });

    await this._updateDotLottieInstanceState();

    return result;
  }

  public async load(config: Omit<Config, 'canvas'>): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('load', { config, instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async setLoop(loop: boolean): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setLoop', { instanceId: this._id, loop });
    await this._updateDotLottieInstanceState();
  }

  public async resize(): Promise<void> {
    if (!this._created) return;

    const { height, width } = getCanvasSize(this._canvas);

    this._canvas.width = width;
    this._canvas.height = height;

    await this._sendMessage('resize', { height, instanceId: this._id, width });
    await this._updateDotLottieInstanceState();
  }

  public async destroy(): Promise<void> {
    if (!this._created) return;

    this._created = false;

    await this._sendMessage('destroy', { instanceId: this._id });

    this._cleanupStateMachineListeners();

    DotLottieWorker._workerManager.unassignAnimationFromWorker(this._id);
    this._eventManager.removeAllEventListeners();
  }

  public async freeze(): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('freeze', { instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async unfreeze(): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('unfreeze', { instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async setBackgroundColor(backgroundColor: string): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setBackgroundColor', { instanceId: this._id, backgroundColor });
    await this._updateDotLottieInstanceState();
  }

  public async loadAnimation(animationId: string): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('loadAnimation', { animationId, instanceId: this._id });
    await this._updateDotLottieInstanceState();
  }

  public async setLayout(layout: Layout): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setLayout', { instanceId: this._id, layout });
    await this._updateDotLottieInstanceState();
  }

  private async _updateDotLottieInstanceState(): Promise<void> {
    if (!this._created) return;

    const result = await this._sendMessage('getDotLottieInstanceState', { instanceId: this._id });

    this._dotLottieInstanceState = result.state;
  }

  public markers(): Marker[] {
    return this._dotLottieInstanceState.markers;
  }

  public async setMarker(marker: string): Promise<void> {
    if (!this._created) return;

    await this._sendMessage('setMarker', { instanceId: this._id, marker });
    await this._updateDotLottieInstanceState();
  }

  public async loadThemeData(themeData: string): Promise<boolean> {
    if (!this._created) return false;

    const loaded = await this._sendMessage('loadThemeData', { instanceId: this._id, themeData });

    await this._updateDotLottieInstanceState();

    return loaded;
  }

  public async setViewport(x: number, y: number, width: number, height: number): Promise<boolean> {
    if (!this._created) return false;

    return this._sendMessage('setViewport', { x, y, width, height, instanceId: this._id });
  }

  private async _sendMessage<T extends keyof MethodParamsMap>(
    method: T,
    params: MethodParamsMap[T],
    transfer?: Transferable[],
  ): Promise<MethodResultMap[T]> {
    const rpcRequest: RpcRequest<T> = {
      id: `dotlottie-request-${generateUniqueId()}`,
      method,
      params,
    };

    this._worker.postMessage(rpcRequest, transfer || []);

    return new Promise((resolve, reject) => {
      const onMessage = (event: MessageEvent): void => {
        const rpcResponse: RpcResponse<T> = event.data;

        // Check if the response corresponds to the request
        if (rpcResponse.id === rpcRequest.id) {
          this._worker.removeEventListener('message', onMessage);

          if (rpcResponse.error) {
            reject(new Error(`Failed to execute method ${method}: ${rpcResponse.error}`));
          } else {
            resolve(rpcResponse.result);
          }
        }
      };

      this._worker.addEventListener('message', onMessage);
    });
  }

  public addEventListener<T extends EventType>(type: T, listener: EventListener<T>): void {
    this._eventManager.addEventListener(type, listener);
  }

  public removeEventListener<T extends EventType>(type: T, listener?: EventListener<T>): void {
    this._eventManager.removeEventListener(type, listener);
  }

  public static setWasmUrl(url: string): void {
    DotLottieWorker._wasmUrl = url;
  }

  public async loadStateMachine(stateMachineId: string): Promise<boolean> {
    if (!this._created) return false;

    const result = await this._sendMessage('loadStateMachine', { instanceId: this._id, stateMachineId });

    await this._updateDotLottieInstanceState();

    return result;
  }

  public async loadStateMachineData(stateMachineData: string): Promise<boolean> {
    if (!this._created) return false;

    const result = await this._sendMessage('loadStateMachineData', { instanceId: this._id, stateMachineData });

    await this._updateDotLottieInstanceState();

    return result;
  }

  public async startStateMachine(): Promise<boolean> {
    if (!this._created) return false;

    this._setupStateMachineListeners();

    const result = await this._sendMessage('startStateMachine', { instanceId: this._id });

    await this._updateDotLottieInstanceState();

    return result;
  }

  public async stopStateMachine(): Promise<boolean> {
    if (!this._created) return false;

    this._cleanupStateMachineListeners();

    return this._sendMessage('stopStateMachine', { instanceId: this._id });
  }

  public async postStateMachineEvent(event: string): Promise<boolean> {
    if (!this._created) return false;

    return this._sendMessage('postStateMachineEvent', { event, instanceId: this._id });
  }

  public async getStateMachineListeners(): Promise<string[]> {
    if (!this._created) return [];

    return this._sendMessage('getStateMachineListeners', { instanceId: this._id });
  }

  private _getPointerPosition(event: PointerEvent): { x: number; y: number } {
    const rect = (this._canvas as HTMLCanvasElement).getBoundingClientRect();
    const scaleX = this._canvas.width / rect.width;
    const scaleY = this._canvas.height / rect.height;

    const devicePixelRatio = this._dotLottieInstanceState.renderConfig.devicePixelRatio || window.devicePixelRatio || 1;
    const x = ((event.clientX - rect.left) * scaleX) / devicePixelRatio;
    const y = ((event.clientY - rect.top) * scaleY) / devicePixelRatio;

    return {
      x,
      y,
    };
  }

  private _onPointerUp(event: PointerEvent): void {
    const { x, y } = this._getPointerPosition(event);

    this.postStateMachineEvent(`OnPointerUp: ${x} ${y}`);
  }

  private _onPointerDown(event: PointerEvent): void {
    const { x, y } = this._getPointerPosition(event);

    this.postStateMachineEvent(`OnPointerDown: ${x} ${y}`);
  }

  private _onPointerMove(event: PointerEvent): void {
    const { x, y } = this._getPointerPosition(event);

    this.postStateMachineEvent(`OnPointerMove: ${x} ${y}`);
  }

  private _onPointerEnter(event: PointerEvent): void {
    const { x, y } = this._getPointerPosition(event);

    this.postStateMachineEvent(`OnPointerEnter: ${x} ${y}`);
  }

  private _onPointerLeave(event: PointerEvent): void {
    const { x, y } = this._getPointerPosition(event);

    this.postStateMachineEvent(`OnPointerExit: ${x} ${y}`);
  }

  private _onComplete(): void {
    this.postStateMachineEvent('OnComplete');
  }

  private async _setupStateMachineListeners(): Promise<void> {
    if (IS_BROWSER && this._canvas instanceof HTMLCanvasElement && this.isLoaded) {
      const listeners = await this._sendMessage('getStateMachineListeners', { instanceId: this._id });

      if (listeners.includes('PointerUp')) {
        this._canvas.addEventListener('pointerup', this._onPointerUp.bind(this));
      }

      if (listeners.includes('PointerDown')) {
        this._canvas.addEventListener('pointerdown', this._onPointerDown.bind(this));
      }

      if (listeners.includes('PointerMove')) {
        this._canvas.addEventListener('pointermove', this._onPointerMove.bind(this));
      }

      if (listeners.includes('PointerEnter')) {
        this._canvas.addEventListener('pointerenter', this._onPointerEnter.bind(this));
      }

      if (listeners.includes('PointerExit')) {
        this._canvas.addEventListener('pointerleave', this._onPointerLeave.bind(this));
      }

      if (listeners.includes('Complete')) {
        this.addEventListener('complete', this._onComplete.bind(this));
      }
    }
  }

  private _cleanupStateMachineListeners(): void {
    if (IS_BROWSER && this._canvas instanceof HTMLCanvasElement) {
      this._canvas.removeEventListener('pointerup', this._onPointerUp.bind(this));
      this._canvas.removeEventListener('pointerdown', this._onPointerDown.bind(this));
      this._canvas.removeEventListener('pointermove', this._onPointerMove.bind(this));
      this._canvas.removeEventListener('pointerenter', this._onPointerEnter.bind(this));
      this._canvas.removeEventListener('pointerleave', this._onPointerLeave.bind(this));
      this.removeEventListener('complete', this._onComplete.bind(this));
    }
  }
}
