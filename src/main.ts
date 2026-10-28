import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { PHYSICS, WORLD, QUALITY, CAMERA, GAMEPLAY, BUS_DIMENSIONS, type QualityTier } from './config.ts';
import { detectQuality, TIER_LABEL, isMobile } from './quality.ts';
import { InputManager } from './input.ts';
import { loadBanglaFont, verifyBanglaShaping } from './util/fonts.ts';
import { bn, bnKm, bnTime, bnClock, bnTaka } from './util/bangla.ts';
import { createState, copyState, stepVehicle, lerpPose, type VehicleInput } from './vehicle/physics.ts';
import { loadBus } from './vehicle/loadBus.ts';
import type { BusRig } from './vehicle/busModel.ts';
import { BusAudio } from './vehicle/audio.ts';
import { Road } from './world/road.ts';
import { Props } from './world/props.ts';
import { SkySystem } from './world/sky.ts';
import { Weather } from './world/weather.ts';
import { Stops } from './world/stops.ts';
import { Blockade } from './world/blockade.ts';
import { Traffic } from './world/traffic.ts';
import { Fork } from './world/fork.ts';
import { Roundabouts } from './world/roundabouts.ts';
import { resolveBusCollisions, COLLIDERS, type Circle, type Contact } from './world/collision.ts';
import { CameraRig, type CameraMode } from './game/camera.ts';
import { Passengers } from './game/passengers.ts';
import { Hud } from './game/hud.ts';
import { RouteEvents } from './game/events.ts';
import { DebugOverlay } from './game/debug.ts';
import { showResults } from './game/results.ts';
import { Career, LIVERIES } from './game/career.ts';
import { ROUTE, ROUTES, applyRoute, savedRouteId, selectRoute } from './routes.ts';
import { buildScenery, sceneryExcludes } from './world/scenery.ts';
import { Damage } from './game/damage.ts';
import { evaluateAchievements } from './game/achievements.ts';
import { buildRecordsPanel } from './game/records.ts';
import { registerSW } from 'virtual:pwa-register';
import { EventProps } from './world/eventProps.ts';
import { buildGaragePanel, applyUpgradeMods } from './game/garage.ts';
import { dailyContracts, evaluateContract, renderContractPicker, CONTRACTS, type ContractDef } from './game/contracts.ts';
import { MODS } from './vehicle/physics.ts';
import { autopilotSteer } from './game/autopilot.ts';
import { PeopleManager, Person, VARIANTS, POLICE_VARIANTS, DRIVER_VARIANT, HELPER_VARIANT, HAWKER_VARIANT, CHADA_VARIANT, type Action } from './world/people.ts';
import { SettingsStore, buildSettingsPanel } from './game/settings.ts';
import { SteeringUI } from './game/steeringUI.ts';
import { RouteMap, type MapState } from './game/minimap.ts';
import { Cinematic } from './game/cinematic.ts';
import { Ledger } from './game/ledger.ts';
import { ChoicePanel } from './game/choice.ts';
import { Incidents } from './game/incidents.ts';
import { Fuel } from './game/fuel.ts';
import { IncidentProps } from './world/incidentProps.ts';

const params = new URLSearchParams(location.search);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type Screen = 'landing' | 'intro' | 'pretrip' | 'driving' | 'results';

class Game {
  tier: QualityTier;
  settings = new SettingsStore();
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  composer: EffectComposer | null = null;
  road!: Road; props!: Props; traffic!: Traffic; fork!: Fork; roundabouts!: Roundabouts;
  sky!: SkySystem; weather!: Weather; stops!: Stops; blockade!: Blockade;
  bus!: BusRig;
  cam: CameraRig;
  input: InputManager;
  audio = new BusAudio();
  hud = new Hud();
  debug = new DebugOverlay();
  passengers = new Passengers();
  events!: RouteEvents;
  people = new PeopleManager();
  /** test hook: the static collider grid */
  colliders = COLLIDERS;
  steeringUI!: SteeringUI;
  map!: RouteMap;
  cinematic!: Cinematic;
  ledger = new Ledger();
  career = new Career();
  choice = new ChoicePanel();
  incidentProps!: IncidentProps; incidents!: Incidents; fuel!: Fuel; damage!: Damage; eventProps!: EventProps;
  screen: Screen = 'landing';
  paused = false;

  // physics
  cur = createState(); prev = createState();
  accumulator = 0; simTime = 0; elapsed = 0;
  routeS = 0; lateral = 0; branchS = 0; onBranch = false;
  running = false; finished = false;
  autopilot = false;
  /** test hooks */
  autopilotRoad: Road | null = null; autopilotDir: 1 | -1 = 1;
  freeCam: { pos: THREE.Vector3; look: THREE.Vector3; fov?: number } | null = null;
  wiperPhase = 0; speedoTimer = 0; minimapTimer = 0; clockTimer = 0;
  lastFrame = performance.now();
  ready = false;
  private surf = { onRoad: true, wet: false, wallDistance: Infinity };
  private tmpV = new THREE.Vector3();
  private lastDt = 1 / 60;
  private lastCrash = -10; private crashPending = false; private crashKind: 'traffic' | 'object' = 'traffic'; private crashImpact = 0;
  private dynCircles: Circle[] = []; private colScratch: Circle[] = []; private contacts: Contact[] = [];
  private helperShoutTimer = 0;
  private boarding: Person[] = [];
  private landingT = 0;
  lastOutcome: import('./game/career.ts').RunOutcome | null = null;
  /** contract chosen on the pre-trip card for the next run */
  contract: ContractDef | null = null;
  lastContract: import('./game/contracts.ts').ContractResult | null = null;
  lastBadges: string[] = [];
  private contractPick: (() => ContractDef | null) | null = null;
  crashes = 0; fuelEmptied = false;
  /** Phase 3: ferry taken on the wrong branch; passengers riding on the roof */
  ferryTaken = false; private ferryOffered = false; roof = 0; private roofRiders: Person[] = []; private roofOffered = false;
  private mirrorTarget: THREE.WebGLRenderTarget | null = null;
  private mirrorCam: THREE.PerspectiveCamera | null = null;
  private tutorialStep = 0; private tutorialTimer = 0;

  constructor() {
    this.tier = this.settings.value.quality === 'auto' ? detectQuality() : this.settings.value.quality;
    if (params.get('quality')) this.tier = detectQuality();
    const q = QUALITY[this.tier];
    const canvas = $('game') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: this.tier !== 'low', powerPreference: 'high-performance', stencil: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, q.pixelRatio));
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; });
    this.cam = new CameraRig(innerWidth / innerHeight);
    const v = params.get('view');
    if (!v) this.cam.setMode(this.settings.value.camera);
    this.input = new InputManager($('touch'));
    this.input.sensitivity = this.settings.value.sensitivity;
    this.input.onCamera = () => this.switchCamera();
    this.input.onDebug = () => this.debug.toggle();
    this.input.onWeather = () => this.toggleWeather();
    this.input.onPause = () => { if (this.screen === 'driving') this.togglePause(); };
    this.input.onMap = () => { if (this.screen === 'driving') this.toggleMap(); };
    $('btn-cam').onclick = () => this.switchCamera();
    $('btn-weather').onclick = () => this.toggleWeather();
    $('btn-map').onclick = () => this.toggleMap();
    $('btn-pause').onclick = () => this.togglePause();
    addEventListener('resize', () => this.resize());
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) document.body.classList.add('reduced-motion');
  }
  contextLost = false;

  async init() {
    const status = $('start-status');
    await loadBanglaFont();
    status.textContent = verifyBanglaShaping() ? 'ফন্ট ঠিক আছে ✓' : 'সতর্কতা: বাংলা ফন্ট ঠিকমতো লোড হয়নি';
    const q = QUALITY[this.tier];
    const maxAniso = Math.min(q.anisotropy, this.renderer.capabilities.getMaxAnisotropy());

    this.road = new Road(maxAniso, { route: ROUTE.route, roundabouts: WORLD.roundabouts.map((r) => r.s), tollS: WORLD.tollS });
    this.scene.add(this.road.group);
    this.roundabouts = new Roundabouts(this.road, maxAniso);
    this.scene.add(this.roundabouts.group);
    this.fork = new Fork(this.road, maxAniso, this.people);
    this.scene.add(this.fork.group);
    // Nothing may be placed on the branch road or the junction side roads (they leave the main corridor)
    const corridor = 12;
    const sceneryEx = sceneryExcludes(this.road, ROUTE.scenery);
    const exclude = (x: number, z: number) => {
      if (sceneryEx(x, z)) return true;
      const b = this.fork.branch.locate(x, z, 0);
      if (b.s > 20 && b.s < this.fork.branch.length && Math.abs(b.lateral) < corridor + 10) return true;
      for (const sr of this.roundabouts.sideRoads) { const l = sr.locate(x, z, 0); if (l.s > -5 && l.s < sr.length + 5 && Math.abs(l.lateral) < corridor) return true; }
      return false;
    };
    this.props = new Props(this.road, this.tier, maxAniso, exclude);
    this.scene.add(buildScenery(this.road, ROUTE.scenery, this.tier));
    this.scene.add(this.props.group);
    this.stops = new Stops(this.road, this.people);
    this.scene.add(this.stops.group);
    this.blockade = new Blockade(this.road, this.tier === 'low', this.people);
    this.scene.add(this.blockade.group);
    this.traffic = new Traffic(this.road, this.tier, this.people);
    this.scene.add(this.traffic.group);
    this.incidentProps = new IncidentProps(this.road, this.people);
    this.eventProps = new EventProps(this.road, this.people); this.scene.add(this.eventProps.group);
    this.scene.add(this.incidentProps.group);
    this.sky = new SkySystem(this.renderer, this.scene, q.shadows, q.shadowMapSize);
    this.weather = new Weather(this.scene, q.rainCount);
    if (params.get('rain') === '1') { this.weather.set(true); this.weather.wet = 1; this.sky.setRain(1); }

    this.bus = await loadBus({ anisotropy: maxAniso, shadows: q.shadows, people: this.people });
    this.scene.add(this.bus.root);
    this.bus.setPassengers(this.passengers.count);
    this.events = new RouteEvents(this.blockade, this.passengers, this.hud, this.bus, this.ledger);
    this.fuel = new Fuel(this.hud, this.ledger, this.choice, this.passengers);
    this.damage = new Damage(this.bus, this.hud, this.passengers);
    this.incidents = new Incidents(this.incidentProps, this.passengers, this.hud, this.ledger, this.choice, this.events, this.scene, this.people); this.incidents.props3 = this.eventProps; this.incidents.onRoofCleared = () => this.clearRoof();
    this.map = new RouteMap(this.road, this.fork.branch, this.roundabouts.sideRoads);
    this.cinematic = new Cinematic(this.cineHost());

    if (q.bloom) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.cam.camera));
      this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.12, 0.35, 1.3));
      this.composer.addPass(new OutputPass());
    }
    if (this.tier !== 'low') { // live rear-view mirror
      this.mirrorTarget = new THREE.WebGLRenderTarget(256, 96);
      this.mirrorCam = new THREE.PerspectiveCamera(50, 256 / 96, 0.5, 300);
      this.bus.setMirrorTexture?.(this.mirrorTarget.texture);
    }

    // UI
    this.steeringUI = new SteeringUI(this.settings, (root) => this.input.bindTouchButtons(root));
    buildSettingsPanel(this.settings, () => this.onSettingsClosed());
    this.settings.onChange((s, k) => {
      if (k === 'sensitivity') this.input.sensitivity = s.sensitivity;
      if (k === 'volume') this.audio.setVolume(s.volume);
      if (k === 'camera' && this.screen !== 'driving') this.cam.setMode(s.camera);
    });
    this.bindMenus();
    if (params.get('people') === '1') this.debugPeopleLineup();
    this.resetRun();
    this.applyNight();
    this.resize();
    this.ready = true;
    status.textContent += `  ·  গ্রাফিক্স: ${TIER_LABEL[this.tier]}`;
    requestAnimationFrame((t) => { this.lastFrame = t; this.frame(t); });

    // Landing scene: sunrise, bus idling toward the camera
    this.sky.setTime(params.get('hour') !== null ? this.sky.state.hour : 6.3);
    this.applyNight();
    if (params.get('autostart') === '1') this.startRun();
    else if (params.get('screen') === 'pretrip') this.showPretrip();
    else if (params.get('screen') === 'intro') this.playIntro();
  }

  // ---- Screens / menus ------------------------------------------------------
  /** Mobile: go fullscreen and lock to landscape on the first user gesture (best effort; needs fullscreen on Android). */
  private async lockLandscape() {
    if (!isMobile()) return;
    try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch { /* not allowed */ }
    try { const o = screen.orientation as ScreenOrientation & { lock?: (t: string) => Promise<void> }; await o.lock?.('landscape'); } catch { /* unsupported (iOS) → the CSS rotate overlay asks the player */ }
    this.resize();
  }

  private bindMenus() {
    $('menu-start').onclick = async () => { await this.lockLandscape(); await this.audio.init(); this.audio.setVolume(this.settings.value.volume); if (this.settings.value.introSeen) this.showPretrip(); else this.playIntro(); };
    $('menu-intro').onclick = async () => { await this.lockLandscape(); await this.audio.init(); this.playIntro(); };
    $('menu-settings').onclick = () => this.openSettings();
    buildGaragePanel(this.career, () => this.applyUpgrades(), () => {});
    $('menu-garage').onclick = () => this.openGarage();
    buildRecordsPanel(this.career, () => {});
    $('menu-records').onclick = () => this.openRecords();
    // PWA: offline cache + install button (shown only when the browser offers an install prompt)
    if (import.meta.env.PROD) {
      registerSW({ immediate: true, onOfflineReady: () => { const s = $('start-status'); s.textContent = (s.textContent ?? '') + ' · অফলাইনেও খেলা যাবে ✓'; } });
    }
    let installEvt: (Event & { prompt(): Promise<void> }) | null = null;
    addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e as typeof installEvt; $('menu-install').classList.remove('hidden'); });
    $('menu-install').onclick = async () => { if (!installEvt) return; await installEvt.prompt(); installEvt = null; $('menu-install').classList.add('hidden'); };
    addEventListener('appinstalled', () => $('menu-install').classList.add('hidden'));
    $('pause-records').onclick = () => this.openRecords();
    $('pause-garage').onclick = () => this.openGarage();
    this.applyUpgrades();
    this.refreshCareerChip();
    // route label + pre-trip route picker (switching routes reloads so the world is rebuilt)
    ($('hud-route').querySelector('b') as HTMLElement).textContent = ROUTE.label;
    $('hud-hint-text').textContent = `আস্তে চালান, ${WORLD.stops[0].name}র হলুদ জোনে থামুন, মোড়ে সাইনবোর্ড দেখুন।`;
    const sel = document.querySelector('.route-select') as HTMLElement;
    sel.innerHTML = ROUTES.map((r) => `<button class="route ${r.id === ROUTE.id ? 'on' : ''}" data-route="${r.id}" ${r.available ? '' : 'disabled'}>${r.label}${r.available ? '' : ' <span class="soon">শিগগিরই</span>'}</button>`).join('');
    sel.querySelectorAll<HTMLButtonElement>('button[data-route]').forEach((b) => b.onclick = () => { if (b.dataset.route !== ROUTE.id) { selectRoute(b.dataset.route as typeof ROUTE.id); const u = new URL(location.href); u.searchParams.delete('route'); location.href = u.toString(); } });
    $('menu-howto').onclick = () => $('howto').classList.remove('hidden');
    $('howto-close').onclick = () => $('howto').classList.add('hidden');
    $('pretrip-go').onclick = () => this.startRun();
    $('fullmap-close').onclick = () => this.toggleMap(false);
    $('pause-resume').onclick = () => this.togglePause(false);
    $('pause-map').onclick = () => { this.toggleMap(true); };
    $('pause-settings').onclick = () => this.openSettings();
    $('pause-howto').onclick = () => $('howto').classList.remove('hidden');
    $('pause-menu').onclick = () => this.goToLanding();
  }
  private openSettings() { $('settings').classList.remove('hidden'); }
  openRecords(tab?: 'badges' | 'runs') { const r = $('records') as HTMLElement & { refresh?: (t?: 'badges' | 'runs') => void }; r.refresh?.(tab); r.classList.remove('hidden'); }
  openGarage() { const g = $('garage') as HTMLElement & { refresh?: () => void }; g.refresh?.(); g.classList.remove('hidden'); }
  /** Career upgrades → physics multipliers, livery paint, horn sound. */
  get mods() { return { ...MODS }; }
  get contractDefs() { return CONTRACTS; }
  /** test hook: force the contract for the next run */
  forceContract(id: string | null) { this.contractPick = () => CONTRACTS.find((c) => c.id === id) ?? null; }
  applyUpgrades() {
    applyUpgradeMods(this.career);
    const s = LIVERIES[this.career.profile.livery] ?? LIVERIES[0];
    this.bus.setLivery?.(s.main, s.dark);
    this.audio.setHorn(this.career.profile.upgrades.horn > 0 ? 'air' : 'stock');
    this.refreshCareerChip();
  }
  private onSettingsClosed() { /* scheme/side changes already applied live */ }

  showPretrip() {
    this.screen = 'pretrip'; this.running = false; this.freeCam = null;
    $('landing').classList.add('hidden'); $('pretrip').classList.remove('hidden'); this.hud.show(false);
    this.resetRun();
    this.map.drawFull($('pretrip-map') as HTMLCanvasElement, this.mapState());
    this.contractPick = renderContractPicker($('pretrip-contracts'), dailyContracts(this.career.level), this.contract?.id ?? null);
    const h = this.clockHour(); const night = h < 6 || h >= 18;
    const rush = h >= GAMEPLAY.morningRushStart && h < GAMEPLAY.morningRushEnd;
    const effect = night ? 'রাত — হেডলাইট জ্বলবে, কুয়াশা, স্ট্যান্ডে যাত্রী কম' : rush ? 'সকালের অফিস টাইম — স্ট্যান্ডে যাত্রী দেড় গুণ' : 'দিন — স্বাভাবিক যাত্রী';
    $('pretrip-clock').textContent = `${bnClock(h)} (${effect})`;
  }

  async playIntro() {
    this.screen = 'intro';
    $('landing').classList.add('hidden'); this.hud.show(false); $('touch').classList.add('hidden'); $('minimap').classList.add('hidden');
    this.running = true; this.cinematicMode = true;
    this.resetRun();
    const r = await this.cinematic.play(this.contextLost);
    this.cinematicMode = false; this.freeCam = null;
    this.settings.set('introSeen', true);
    void r;
    this.resetRun();
    this.sky.setTime(this.clockHour());
    this.showPretrip();
  }
  cinematicMode = false;
  private clockHour() { const h = params.get('hour'); if (h !== null) return parseFloat(h); const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

  goToLanding() {
    this.togglePause(false); this.toggleMap(false);
    this.screen = 'landing'; this.running = false; this.hud.show(false); $('touch').classList.add('hidden'); $('minimap').classList.add('hidden');
    $('results').classList.add('hidden'); $('landing').classList.remove('hidden');
    this.refreshCareerChip();
    this.resetRun(); this.sky.setTime(6.3); this.applyNight();
  }

  togglePause(force?: boolean) {
    const on = force ?? !this.paused;
    this.paused = on; $('pause').classList.toggle('hidden', !on);
    if (on) { $('fullmap').classList.add('hidden'); }
  }
  toggleMap(force?: boolean) {
    const on = force ?? $('fullmap').classList.contains('hidden');
    $('fullmap').classList.toggle('hidden', !on);
    if (on) { $('pause').classList.add('hidden'); this.paused = true; this.refreshFullMap(); } else if (!$('pause').classList.contains('hidden')) this.paused = true; else this.paused = false;
  }
  private refreshFullMap() {
    const kmh = Math.abs(this.cur.v) * 3.6;
    const remaining = Math.max(0, WORLD.finishS - this.routeS);
    const eta = remaining / Math.max(12, Math.min(25, kmh / 3.6 || 14));
    this.map.drawFull($('fullmap-canvas') as HTMLCanvasElement, this.mapState(), { remaining, eta });
    $('fullmap-info').innerHTML = `<span>বাকি: ${bnKm(remaining)}</span><span>আনুমানিক সময়: ${bnTime(eta)}</span><span>যাত্রী: ${bn(this.passengers.count)}</span>${this.events.wrongBranch ? '<span style="color:#1f6fb5">↩ রাস্তা ভুল — ঘুরে মূল রাস্তায় ফিরুন</span>' : ''}${this.contract ? `<span style="color:#8a1216">📜 ${this.contract.name}: ${this.contract.desc}</span>` : ''}`;
  }
  mapState(): MapState {
    return { x: this.cur.x, z: this.cur.z, yaw: this.cur.yaw, s: this.routeS, onBranch: this.onBranch, wrongBranch: this.events.wrongBranch,
      blockadeActive: this.blockade.active, stoppedAtRajbari: this.events.stoppedAtRajbari, kmh: Math.abs(this.cur.v) * 3.6, northUp: this.settings.value.northUp,
      stopsDone: this.events.stops.map((x) => x.done || x.missed), nextStopS: this.events.nextStop(this.routeS) >= 0 ? WORLD.stops[this.events.nextStop(this.routeS)].s : undefined };
  }

  resetRun() {
    const s0 = 60;
    const f = this.road.sample(s0);
    const lane = WORLD.driveOnLeft ? -WORLD.laneWidth / 2 : WORLD.laneWidth / 2;
    const st = createState(f.x + f.rx * lane, f.z + f.rz * lane, this.road.yawAt(s0));
    copyState(this.cur, st); copyState(this.prev, st);
    this.routeS = s0; this.branchS = 0; this.onBranch = false; this.elapsed = 0; this.simTime = 0; this.finished = false;
    this.passengers = new Passengers();
    this.bus.setPassengers(this.passengers.count);
    this.ledger.reset(); this.ledger.fares = this.passengers.count * GAMEPLAY.fareKushtiaDhaka; // helper collected at the terminal
    this.events = new RouteEvents(this.blockade, this.passengers, this.hud, this.bus, this.ledger);
    this.events.onStopBegin = (i) => this.beginBoarding(i);
    this.events.onStopEnd = (i) => this.endBoarding(i);
    if (this.incidents) this.incidents.reset();
    this.incidents = new Incidents(this.incidentProps, this.passengers, this.hud, this.ledger, this.choice, this.events, this.scene, this.people); this.incidents.props3 = this.eventProps; this.incidents.onRoofCleared = () => this.clearRoof();
    this.fuel = new Fuel(this.hud, this.ledger, this.choice, this.passengers);
    this.crashes = 0; this.fuelEmptied = false;
    this.ferryTaken = false; this.ferryOffered = false; this.roofOffered = false; this.clearRoof();
    this.damage = new Damage(this.bus, this.hud, this.passengers); this.damage.reset();
    this.fuel.litres = GAMEPLAY.fuelTankLitres * (GAMEPLAY.fuelStartFraction[0] + Math.random() * (GAMEPLAY.fuelStartFraction[1] - GAMEPLAY.fuelStartFraction[0])); // the owner never fills it
    const hr = this.clockHour(); this.events.waitingMultiplier = hr >= GAMEPLAY.morningRushStart && hr < GAMEPLAY.morningRushEnd ? 1.5 : (hr >= 21 || hr < 5) ? 0.5 : 1;
    this.blockade.reset();
    this.debug.resetMeasure();
    this.input.override = null; this.autopilot = false;
    this.bus.setDoor(0); this.bus.setPassengerPose('idle');
    this.syncVisual(1);
    this.cam.snap();
  }

  startRun() {
    $('landing').classList.add('hidden'); $('pretrip').classList.add('hidden'); $('results').classList.add('hidden');
    this.screen = 'driving'; this.paused = false; this.freeCam = null;
    if (this.contractPick) this.contract = this.contractPick();
    this.resetRun();
    this.sky.setTime(this.clockHour()); this.applyNight();
    if (!params.get('view')) this.cam.setMode(this.settings.value.camera);
    this.hud.show(true); $('minimap').classList.remove('hidden');
    if (this.contract) this.toast(`📜 কন্ট্রাক্ট: ${this.contract.name} — ${this.contract.desc}`, 9000);
    if (isMobile() || params.get('touch') === '1') { $('touch').classList.remove('hidden'); if (params.get('touch') === '1') $('touch').classList.add('force'); }
    this.running = true;
    this.hud.message(`শুভ যাত্রা! আস্তে চালান, যাত্রী নিয়ে ${ROUTE.to} চলুন`, true, 3500);
    this.toast(`🕒 আসল সময়: ${bnClock(this.clockHour())} — খেলার দিন-রাত আপনার ঘড়ি অনুযায়ী চলে`, 7000);
    this.bus.setCockpitMode(this.cam.mode === 'cockpit');
    this.tutorialStep = this.settings.value.tutorialSeen ? 99 : 0; this.tutorialTimer = 0;
    this.helperShout();
  }

  switchCamera(mode?: CameraMode) {
    if (mode) this.cam.setMode(mode); else this.cam.next();
    this.bus.setCockpitMode(this.cam.mode === 'cockpit');
  }

  toggleWeather() {
    const on = this.weather.toggle();
    this.sky.setRain(on ? 1 : 0);
    this.hud.message(on ? 'বৃষ্টি শুরু — রাস্তা পিচ্ছিল!' : 'রোদ উঠেছে ☀️', !on, 2500);
  }

  applyNight() {
    const night = this.sky.state.night;
    this.props.setNight(night); this.roundabouts?.setNight(night);
    this.bus.setLights({ headlights: night || this.weather.wet > 0.5, brake: this.cur.brake, reverse: this.cur.v < -0.2 });
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.composer?.setSize(innerWidth, innerHeight);
    this.cam.resize(innerWidth / innerHeight);
  }

  // ---- Tutorial toasts -------------------------------------------------------
  private toast(text: string, ms = 6000) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
    t.onclick = () => t.remove(); $('toasts').appendChild(t);
    setTimeout(() => t.remove(), ms);
  }
  private tutorial(dt: number) {
    if (this.tutorialStep >= 5) return;
    this.tutorialTimer += dt;
    const steps = ['গ্যাস চেপে চলা শুরু করুন — ধীরে ধীরে, যাত্রীরা দেখছে', 'A/D বা স্টিয়ারিং দিয়ে বাঁয়ে-ডানে — রাস্তার বাম লেনে থাকুন', 'ব্রেক আস্তে চাপুন; হঠাৎ ব্রেকে যাত্রীর মেজাজ পড়ে', 'C চেপে ক্যামেরা বদলান, M চেপে ম্যাপ দেখুন', `মিনিম্যাপে 🚏 = পরের স্টপ। ${WORLD.stops[0].name}র হলুদ জোনে থামুন`];
    const at = [1, 7, 15, 24, 34];
    if (this.tutorialTimer > at[this.tutorialStep]) { this.toast(steps[this.tutorialStep]); this.tutorialStep++; if (this.tutorialStep >= 5) this.settings.set('tutorialSeen', true); }
  }
  private helperShout() {
    if (!this.bus.helper) return;
    this.hud.bubble({ kind: 'good', text: `${ROUTE.to} ${ROUTE.to}! সিট আছে — উঠেন!` });
  }

  // ---- Cinematic host -------------------------------------------------------
  private cineHost() {
    const g = this;
    return {
      scene: g.scene, get busBody() { return g.bus.body; }, get busRoot() { return g.bus.root; },
      setCamera(pos: THREE.Vector3, look: THREE.Vector3, fov?: number) { g.freeCam = { pos: pos.clone(), look: look.clone(), fov }; },
      teleport(s: number) { g.teleport(s); },
      drive(throttle: number, brake: number, autopilot: boolean) { g.input.override = { throttle, brake, steer: 0, handbrake: false, horn: false }; g.autopilot = autopilot; },
      setHour(h: number) { g.sky.setTime(h); g.applyNight(); },
      people: g.people, get driver() { return g.bus.driver; }, get helper() { return g.bus.helper; },
      get blockade() { return g.blockade; },
      setDriverHandTarget(side: 'L' | 'R', p: THREE.Vector3 | null) { g.bus.setDriverHandTarget(side, p); },
      audioSting(kind: 'start' | 'horn') { g.audio.sting(kind); },
      roadSample(s: number) { return g.road.sample(s); },
      get isLowTier() { return g.tier === 'low'; },
      setPassengerPose(a: Action) { g.bus.setPassengerPose(a); },
    };
  }

  /** One fixed physics step. */
  physicsStep(dt: number, raw: VehicleInput) {
    const loc = this.road.locate(this.cur.x, this.cur.z, this.routeS);
    const br = this.fork.locate(this.cur.x, this.cur.z, this.branchS);
    this.branchS = br.s;
    const bl = this.road.bulge(loc.s);
    const mainOn = Math.abs(loc.lateral) < WORLD.roadWidth / 2 + bl + WORLD.shoulderWidth * 0.6 && !this.roundabouts.inside(this.cur.x, this.cur.z, loc.s);
    const branchOn = br.onBranch && Math.abs(br.lateral) < WORLD.roadWidth / 2 + WORLD.shoulderWidth * 0.6;
    this.onBranch = br.onBranch && !mainOn;
    if (this.onBranch) { this.routeS = WORLD.forkS; this.lateral = br.lateral; } else { this.routeS = loc.s; this.lateral = loc.lateral; }
    this.surf.onRoad = mainOn || branchOn || (br.onBranch && br.s > this.fork.branch.length - 30 && Math.abs(br.lateral) < 16) || (bl > 0.2 || Math.abs(loc.lateral) > WORLD.roadWidth / 2 ? this.roundabouts.onSideRoad(this.cur.x, this.cur.z) : false);
    this.surf.wet = this.weather.wet > 0.5;
    const islandWall = this.cinematicMode ? Infinity : this.roundabouts.wallDistance(this.cur.x - Math.sin(this.cur.yaw) * 5.6, this.cur.z - Math.cos(this.cur.yaw) * 5.6, this.cur.yaw, loc.s);
    const incWall = this.cinematicMode ? Infinity : this.incidents.wallDistance(loc.s + 5.6);
    // traffic is not a wall any more: hitting a vehicle is a momentum exchange in resolveBusCollisions
    this.surf.wallDistance = Math.min(this.events.wallDistance(loc.s + 5.6), islandWall, incWall);
    const inp = this.running && !this.finished && !this.paused ? { ...raw } : { throttle: 0, brake: 1, steer: 0, handbrake: true };
    if (this.fuel.engineFactor === 0 && !this.cinematicMode) inp.throttle = 0;
    if (this.events.phase === 'stop' || this.choice.open) { inp.throttle = 0; inp.brake = 0; inp.handbrake = true; } // handbrake, not brake: holding the brake while stopped would creep into reverse
    copyState(this.prev, this.cur);
    stepVehicle(this.cur, inp, this.surf, dt);
    if (!this.cinematicMode && this.running) this.fuel.burn(dt, this.cur.throttle, this.cur.rpm);
    // Solid world: resolve against props, parked vehicles, traffic and the police van
    if (!this.cinematicMode) {
      this.dynCircles.length = 0;
      if (!this.onBranch) this.traffic.nearbyCircles(this.routeS, 40, this.dynCircles);
      this.blockade.vanCircles(this.dynCircles);
      if (!this.eventProps.wreckClear && Math.abs(this.routeS - WORLD.accidentS) < 60) this.eventProps.wreckCircles(this.dynCircles);
      const col = resolveBusCollisions(this.cur, this.dynCircles, this.colScratch, this.contacts);
      if (col.contacts.length) this.traffic.applyContacts(col.contacts);
      if (col.hit && col.impact > 2.0 && this.simTime - this.lastCrash > 2.5) { this.lastCrash = this.simTime; /* sim time: counts in scripted runs too */ this.crashPending = true; this.crashes++; this.crashKind = col.contacts.some((c) => c.into > 1) ? 'traffic' : 'object'; this.crashImpact = col.impact; }
    }
    this.simTime += dt;
    this.debug.physicsSample(this.cur.v * 3.6, inp.throttle, this.simTime);
  }

  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t));
    let dt = (now - this.lastFrame) / 1000; this.lastFrame = now;
    if (dt > 0.25) dt = 0.25;
    this.lastDt = dt;
    const raw = this.input.poll();
    if (this.autopilot) raw.steer = autopilotSteer(this.road, this.routeS, this.cur);
    if (this.cinematic?.active) this.cinematic.update(dt);

    // ---- fixed-step physics ----------------------------------------------
    const h = 1 / PHYSICS.hz;
    if (this.running && !this.paused) {
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= h && steps < PHYSICS.maxStepsPerFrame) { this.physicsStep(h, raw); this.accumulator -= h; steps++; }
      if (steps === PHYSICS.maxStepsPerFrame) this.accumulator = 0;
      if (!this.finished && !this.cinematicMode) this.elapsed += dt;
    }
    const alpha = this.running && !this.paused ? this.accumulator / h : 1;

    // ---- gameplay ----------------------------------------------------------
    const kmh = Math.abs(this.cur.v) * 3.6;
    const driving = this.screen === 'driving' && this.running && !this.finished && !this.paused;
    if (driving) {
      this.events.update(dt, this.routeS, kmh, this.elapsed);
      this.events.updateBranch(dt, this.onBranch, this.branchS);
      const shouts = this.passengers.update(dt, {
        kmh, aLong: this.cur.aLong, aLat: this.cur.aLat, onRoad: this.cur.onRoad, waiting: this.events.waitingAtBlockade,
        horn: raw.horn, moving: kmh > 1, time: this.elapsed,
      });
      for (const s of shouts) this.hud.bubble(s);
      if (this.events.phase === 'finished') this.finish();
      this.tutorial(dt);
      this.incidents.update(dt, this.routeS, kmh, this.bus.root.position, this.cur.yaw);
      void this.fuel.update(dt, this.routeS, kmh, this.lateral, kmh < 2);
      if (this.fuel.state === 'empty') this.fuelEmptied = true;
      if (!this.ferryOffered && kmh < 2 && !this.choice.open && this.branchS > this.fork.branch.length - 70) {
        // stopped in the ghat (last 70 m of the branch or on the turnaround pad just past its end)
        const br = this.fork.locate(this.cur.x, this.cur.z, this.branchS);
        if (br.s < this.fork.branch.length + 14 && Math.abs(br.lateral) < 16) { this.ferryOffered = true; void this.offerFerry(); }
      }
      if (this.roof > 0 && kmh > 60 && Math.random() < dt * 0.25) this.passengers.shout('roof');
      if (this.crashPending) {
        this.crashPending = false;
        const pen = Math.min(15, 3 + this.crashImpact * 0.8);
        this.passengers.mood = Math.max(0, this.passengers.mood - pen);
        this.damage.hit(this.crashImpact, this.crashKind);
        this.hud.message(this.crashKind === 'traffic' ? 'সামনের গাড়িতে ধাক্কা! সাবধানে!' : 'ধাক্কা লেগেছে! রাস্তায় থাকুন');
        this.passengers.shout(this.crashKind === 'traffic' ? 'brake' : 'swerve', true);
        this.audio.sting('crash');
      }
    }
    // Real-time clock: re-read the device time once a minute so the sky keeps moving during a trip
    if (this.screen === 'driving' && params.get('hour') === null) {
      this.clockTimer += dt;
      if (this.clockTimer > 60) { this.clockTimer = 0; const h = this.clockHour(); if (Math.abs(h - this.sky.state.hour) > 1 / 120) { this.sky.setTime(h); this.applyNight(); } }
    }
    if (!this.paused) {
      this.blockade.update(dt);
      this.traffic.barrierS = this.blockade.active ? WORLD.andolonS - 1.2 : Infinity;
      this.traffic.laneBarrierS = this.eventProps.wreckClear ? Infinity : WORLD.accidentS - 8;
      this.traffic.update(dt, this.routeS, this.lateral, this.cur.v, this.cam.camera.position, this.running && !this.finished && !this.onBranch && !this.cinematicMode);
      this.people.update(dt, this.cam.camera.position);
      this.incidentProps.update(dt); this.eventProps.update(dt);
      this.stops.update(this.elapsed, this.routeS);
    }

    // ---- visuals -------------------------------------------------------------
    this.syncVisual(alpha);
    const rough = this.cur.onRoad ? 0.15 : 1;
    if (this.screen === 'landing') this.landingCamera(dt);
    if (this.freeCam) { this.cam.camera.position.copy(this.freeCam.pos); this.cam.camera.lookAt(this.freeCam.look); if (this.freeCam.fov) { this.cam.camera.fov = this.freeCam.fov; this.cam.camera.updateProjectionMatrix(); } }
    else this.cam.update(this.bus.root, this.bus.body, kmh, rough, dt, this.cur.aLat);
    this.sky.follow(this.bus.root.position);
    const vel = this.tmpV.set(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw)).multiplyScalar(this.cur.v);
    this.weather.update(dt, this.cam.camera.position, vel);
    this.road.setWet(this.weather.wet);
    const night = this.sky.state.night;
    this.bus.setLights({ headlights: night || this.weather.wet > 0.5, brake: this.cur.brake, reverse: this.cur.v < -0.2 });
    if (this.weather.wet > 0.05) { this.wiperPhase = (this.wiperPhase + dt * 0.7) % 1; this.bus.setWipers(this.wiperPhase); } else this.bus.setWipers(null);
    this.speedoTimer += dt;
    if (this.speedoTimer > 0.1) { this.speedoTimer = 0; this.bus.updateSpeedo(kmh, this.cur.rpm, this.cur.gear + 1); }
    this.steeringUI.update(dt, this.cur.steerInput);
    this.input.analogSteer = this.steeringUI.steer;

    if (this.screen === 'driving') {
      this.hud.update(kmh, this.cur.gear, this.passengers.mood, this.passengers.count, this.elapsed, WORLD.finishS - this.routeS, kmh < 0.5, this.ledger.net);
      if (this.roof > 0) $('hud-pass').textContent += ` +${bn(this.roof)} ছাদে`;
      this.updateBanner();
      const fv = $('hud-fuel-val'); fv.textContent = bn(Math.round(this.fuel.fraction * 100)) + '%'; fv.classList.toggle('low', this.fuel.fraction < 0.25);
      this.damage.update(dt, kmh);
      const dp = $('hud-damage'); dp.classList.toggle('hidden', this.damage.value <= 0); $('hud-damage-val').textContent = this.damage.label(); $('hud-damage-val').classList.toggle('low', this.damage.value >= 50);
      $('crack').classList.toggle('hidden', !(this.cam.mode === 'cockpit' && this.damage.value >= 30)); $('crack').style.opacity = String(Math.min(1, (this.damage.value - 20) / 60));
      this.minimapTimer += dt;
      if (this.minimapTimer > 0.1) { this.minimapTimer = 0; const c = $('minimap').querySelector('canvas')!; this.map.drawMini(c, this.mapState()); $('minimap-pct').textContent = this.map.progressPercent(this.routeS); }
      if (kmh < 1 && (this.routeS < 120 || this.events.phase === 'stop')) { this.helperShoutTimer += dt; if (this.helperShoutTimer > 6) { this.helperShoutTimer = 0; this.helperShout(); } }
    }
    this.audio.update(dt, this.cur.rpm, this.cur.throttle, kmh, raw.horn && this.running, this.cur.onRoad, this.weather.wet);

    // rear-view mirror (cockpit only, every other frame)
    if (this.mirrorTarget && this.mirrorCam && this.cam.mode === 'cockpit' && !this.freeCam && (this.debug.frameCount & 1) === 0) {
      this.bus.body.updateMatrixWorld(true);
      this.mirrorCam.position.set(0.1, 2.7, -5.0).applyMatrix4(this.bus.body.matrixWorld);
      const back = new THREE.Vector3(0.1, 2.2, 20).applyMatrix4(this.bus.body.matrixWorld);
      this.mirrorCam.lookAt(back);
      this.renderer.setRenderTarget(this.mirrorTarget); this.renderer.render(this.scene, this.mirrorCam); this.renderer.setRenderTarget(null);
    }

    if (this.composer && !this.freeCam) this.composer.render(); else this.renderer.render(this.scene, this.cam.camera);
    this.debug.frame(dt, {
      'speed km/h': kmh, rpm: this.cur.rpm, gear: this.cur.gear + 1, steer: this.cur.steerAngle, 'aLat': this.cur.aLat, 'aLong': this.cur.aLong,
      mood: this.passengers.mood, s: this.routeS, lateral: this.lateral, onRoad: String(this.cur.onRoad), phase: this.events.phase, branch: String(this.onBranch),
      tier: this.tier, cam: this.cam.mode, screen: this.screen, calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, people: this.people.people.length,
    });
  }

  private updateBanner() {
    const s = this.routeS, e = this.events;
    if (e.wrongBranch) this.hud.setBanner('রাস্তা ভুল!', `ঘুরে ${ROUTE.names.bridge}র রাস্তায় ফিরুন`, true);
    else if (e.phase === 'stop') this.hud.setBanner(`${WORLD.stops[e.currentStop]?.name ?? ''} বাস স্ট্যান্ড`, 'যাত্রী নামছে / উঠছে…');
    else if (e.nextStop(s) >= 0 && s > WORLD.stops[e.nextStop(s)].s - 260) this.hud.setBanner(`বাস স্টপ সামনে — ${WORLD.stops[e.nextStop(s)].name}`, 'হলুদ জোনে থেমে যাত্রী তুলুন');
    else if (this.blockade.active && s > WORLD.andolonS - 300 && s < WORLD.andolonS) this.hud.setBanner(e.phase === 'blockade' ? 'অবরোধ — অপেক্ষা করুন' : 'সামনে অবরোধ!', e.phase === 'blockade' ? 'পুলিশ এলে রাস্তা খুলবে' : 'গতি কমান, থামুন', true);
    else if (s > WORLD.forkS - 200 && s < WORLD.forkS + 40) this.hud.setBanner('মোড় সামনে', `${ROUTE.names.correctWay}: সোজা যান`);
    else if (this.incidents.checkpoint === 'approach' || this.incidents.checkpoint === 'stopped') this.hud.setBanner(this.incidents.checkpoint === 'stopped' ? 'চেকপোস্ট — কাগজপত্র চেক' : 'পুলিশ চেকপোস্ট সামনে', this.incidents.checkpoint === 'stopped' ? 'একটু অপেক্ষা করুন' : `${GAMEPLAY.checkpointSpeedLimitKmh} কিমি/ঘ-এর নিচে নামুন`, this.incidents.checkpoint === 'stopped');
    else if (s > WORLD.speedCameraS - 180 && s < WORLD.speedCameraS) this.hud.setBanner('স্পিড ক্যামেরা সামনে', `সর্বোচ্চ ${WORLD.speedCameraLimitKmh} কিমি/ঘ`);
    else if (this.fuel.fraction < 0.6 && s > WORLD.pumpS - 220 && s < WORLD.pumpS + 10) this.hud.setBanner('⛽ পাম্প সামনে বামে', 'সবুজ জোনে থামলে তেল ভরা যাবে');
    else if (s > WORLD.finishS - 400) this.hud.setBanner(`${ROUTE.to} প্রায় এসে গেছে`, 'শেষ লাইনের দিকে চালান');
    else this.hud.setBanner(null);
  }

  /** Landing page: slow orbit around the idling bus at sunrise. */
  private landingCamera(dt: number) {
    this.landingT += dt * 0.12;
    const r = 15, a = this.landingT;
    const base = this.bus.root.position;
    this.freeCam = { pos: new THREE.Vector3(base.x + Math.sin(a) * r, 2.2 + Math.sin(a * 0.7) * 0.6, base.z + Math.cos(a) * r), look: new THREE.Vector3(base.x, 1.8, base.z), fov: 50 };
  }

  /** Stop dwell: waiting passengers walk to the door and board; alighting passengers step off and walk to the shed. */
  private beginBoarding(i: number) {
    if (i === 1) { const r = new THREE.Vector3(Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw)); const f = new THREE.Vector3(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw)); const d = new THREE.Vector3(this.bus.root.position.x, 0, this.bus.root.position.z).addScaledVector(r, -2.2).addScaledVector(f, 4.0); void this.incidents.beginAlms(d, f, r); }
    const right = new THREE.Vector3(Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw));
    const door = new THREE.Vector3(this.bus.root.position.x, 0, this.bus.root.position.z).addScaledVector(right, -2.2).addScaledVector(fwd, 4.0);
    const want = Math.round(WORLD.stops[i].waiting * this.events.waitingMultiplier);
    const list = this.stops.waiting[i].slice(0, want);
    list.forEach((p, k) => {
      p.walkSpeed = 1.1 + (k % 3) * 0.15;
      p.walkTo(door.clone().addScaledVector(right, -0.6 * (k % 4)).addScaledVector(fwd, -0.4 * Math.floor(k / 4)), 'queue', () => { setTimeout(() => this.stops.board(i, p), 500 + k * 350); });
    });
    // alighting: a few people appear at the door and walk to the shed front
    const n = Math.min(3, WORLD.stops[i].getOff);
    for (let k = 0; k < n; k++) {
      const p = new Person(VARIANTS[(i * 3 + k * 5 + 2) % VARIANTS.length]);
      p.position.copy(door).addScaledVector(right, -0.3); p.root.visible = false;
      setTimeout(() => { if (this.events.phase !== 'stop') return; p.root.visible = true; p.walkTo(this.stops.shedFront[i].clone().addScaledVector(fwd, -k * 1.2), 'idle', () => setTimeout(() => { this.scene.remove(p.root); this.people.remove(p); }, 8000)); }, 600 + k * 900);
      this.scene.add(p.root); this.people.add(p); this.boarding.push(p);
    }
  }
  private endBoarding(i: number) {
    // anyone still queueing boards instantly; the alighters keep walking
    for (const p of this.stops.waiting[i].slice()) if (p.target || p.action === 'queue') this.stops.board(i, p);
    this.boarding = this.boarding.filter((p) => p.root.parent);
    if (i === 0 && !this.roofOffered) { this.roofOffered = true; void this.offerRoof(); }
  }

  /** Rajbari: the helper wants to put extra passengers on the roof — more fare, less grip, trouble at the checkpoint. */
  private async offerRoof() {
    const n = GAMEPLAY.roofSeats, fare = n * GAMEPLAY.roofFare;
    const pick = await this.choice.ask('“ওস্তাদ, ছাদে আরও ৮ জন নিই?”', `হেল্পার বলছে ছাদে ${bn(n)} জন নিলে ${bnTaka(fare)} বেশি আসবে। কিন্তু বাস দুলবে, গতি ${bn(GAMEPLAY.roofSpeedCapKmh)}-এর বেশি তোলা যাবে না, আর চেকপোস্টে ধরলে জরিমানা।`, `ছাদে নিন (+${bnTaka(fare)})`, 'না, ছাদে না', 10, 1);
    if (pick !== 0 || this.screen !== 'driving') return;
    this.roof = n; this.ledger.fares += fare; this.incidents.roofLoad = true;
    MODS.roofGrip = 0.9; MODS.roofCapKmh = GAMEPLAY.roofSpeedCapKmh;
    const seats: [number, number][] = [[-0.6, -3.6], [0.6, -3.6], [-0.6, -2.7], [0.6, -2.7], [-0.6, 2.7], [0.6, 2.7], [-0.6, 3.5], [0.6, 3.5]];
    seats.slice(0, n).forEach(([x, z], k) => {
      const p = new Person(VARIANTS[(k * 7 + 3) % VARIANTS.length]); p.root.position.set(x, BUS_DIMENSIONS.height + 0.1, z); p.root.rotation.y = Math.PI;
      p.setAction('sit'); p.mesh.castShadow = false; p.mesh.frustumCulled = false; this.bus.body.add(p.root); this.people.add(p); this.roofRiders.push(p);
    });
    this.hud.message(`${bn(n)} জন ছাদে উঠল — ভাড়া +${bnTaka(fare)}। আস্তে চালান!`, true, 4000);
    this.passengers.shout('roof', true);
  }
  clearRoof() {
    for (const p of this.roofRiders) { this.bus.body.remove(p.root); this.people.remove(p); }
    this.roofRiders = []; this.roof = 0; MODS.roofGrip = 1; MODS.roofCapKmh = Infinity;
    if (this.incidents) this.incidents.roofLoad = false;
  }

  /** Daulatdia ghat at the end of the wrong branch: cross by ferry (slow, costs money, skips the road) or turn back. */
  private async offerFerry() {
    const pick = await this.choice.ask(`⛴️ ${ROUTE.names.ghat}`, `ফেরিতে ${ROUTE.names.river} পার হলে ${bnTaka(GAMEPLAY.ferryCost)} আর প্রায় ${bn(Math.round(GAMEPLAY.ferryWaitSec / 60 * 10) / 10)} মিনিট লাইন — ওপারে সরাসরি ${ROUTE.to} হাইওয়ে, কিন্তু ${ROUTE.names.lostStops} হাতছাড়া।`, `ফেরিতে পার হন (${bnTaka(GAMEPLAY.ferryCost)})`, 'ঘুরে ফিরে যান', 15, 1);
    if (pick !== 0 || this.screen !== 'driving') { this.ferryOffered = false; return; }
    const fade = $('fade'); fade.classList.add('on');
    await new Promise((r) => setTimeout(r, 800));
    this.ferryTaken = true; this.ledger.toll += GAMEPLAY.ferryCost; this.elapsed += GAMEPLAY.ferryWaitSec;
    this.passengers.mood = Math.max(0, this.passengers.mood - 8);
    for (const i of [1, 2]) if (!this.events.stops[i].done) this.events.stops[i].missed = true; // served by the ferry route, no mood penalty
    this.teleport(ROUTE.ferryLandS); this.autopilotRoad = null;
    this.events.updateBranch(0, false, 0);
    this.incidents.checkpoint = 'cleared'; this.incidents.accident = 'passed'; this.incidents.toll = 'paid'; this.incidents.cameraDone = true;
    this.hud.message(`⛴️ ফেরিতে ${ROUTE.names.river} পার — ${bn(Math.round(GAMEPLAY.ferryWaitSec / 60))} মিনিট গেল, এখন ${ROUTE.to} হাইওয়ে`, true, 5000);
    setTimeout(() => fade.classList.remove('on'), 400);
  }

  /** Apply interpolated physics pose to the bus rig. */
  syncVisual(alpha: number) {
    const p = lerpPose(this.prev, this.cur, alpha);
    const r = this.bus.root, b = this.bus.body;
    r.position.set(p.x, 0, p.z); r.rotation.y = p.yaw;
    b.rotation.set(p.pitch, 0, p.roll); b.position.y = p.heave;
    for (const w of this.bus.wheelSpin) w.rotation.x = -p.wheelSpin;
    for (const w of this.bus.wheelSteer) w.rotation.y = -p.steerAngle;
    if (this.bus.steeringWheel && !this.bus.driver) this.bus.steeringWheel.rotation.z = -p.steerAngle * 4.5;
    this.bus.updateDriver(p.steerAngle, this.lastDt, this.input.state.horn, Math.abs(this.cur.aLat) > 2.5);
  }

  refreshCareerChip() {
    const el = $('career-chip');
    el.innerHTML = this.career.summaryHtml(); el.classList.remove('hidden');
  }

  finish() {
    this.finished = true; this.screen = 'results';
    const sm = this.passengers.summary;
    this.ledger.repair = this.damage.repairCost;
    const cr = evaluateContract(this.contract, {
      timeSec: this.elapsed, mood: this.passengers.mood, missedStops: this.events.stops.filter((s) => s.missed).length, stopsDone: this.events.stopsDone, passengers: this.passengers.count + this.roof,
      fines: this.ledger.fines, hardBrakes: sm.hardBrakes, crashes: this.crashes, chadaPaid: this.ledger.chada, refuels: this.fuel.refuels, fuelEmptied: this.fuelEmptied, wrongBranches: this.events.wrongBranchCount,
    });
    this.lastContract = cr;
    const outcome = this.career.recordRun({ net: this.ledger.net, stars: this.passengers.stars(), passengers: this.passengers.count, stopsDone: this.events.stopsDone, fines: this.ledger.fines, timeSec: this.elapsed, hardBrakes: sm.hardBrakes,
      contractBonus: cr?.done ? cr.def.bonus : 0, contractXp: cr?.done ? cr.def.xp : 0 });
    this.lastOutcome = outcome;
    const hr = this.clockHour();
    const fresh = evaluateAchievements({
      stars: this.passengers.stars(), net: this.ledger.net, timeSec: this.elapsed, passengers: this.passengers.count + this.roof, fines: this.ledger.fines, crashes: this.crashes,
      chadaPaid: this.ledger.chada, chadaRefused: this.incidents.chada.some((c) => c === 'done' || c === 'skipped') && this.ledger.chada === 0, missedStops: this.events.stops.filter((s) => s.missed).length, mood: this.passengers.mood,
      damage: this.damage.value, ferry: this.ferryTaken, roof: this.roof, night: hr >= 20 || hr < 5, contractDone: !!cr?.done, refuels: this.fuel.refuels, hardBrakes: sm.hardBrakes,
    }, this.career.profile, this.career.level);
    this.career.save(); this.lastBadges = fresh.map((a) => a.id);
    showResults({
      timeSec: this.elapsed, passengers: this.passengers.count, income: this.events.income, mood: this.passengers.mood,
      stars: this.passengers.stars(), shouts: sm.shouts, hardBrakes: sm.hardBrakes, swerves: sm.swerves, stoppedAtRajbari: this.events.stoppedAtRajbari,
      stopsDone: this.events.stopsDone, stopsTotal: WORLD.stops.filter((x) => x.waiting > 0).length, fares: this.ledger.fares, fines: this.ledger.fines, chada: this.ledger.chada, fuel: this.ledger.fuel, charity: this.ledger.charity,
      career: outcome, contractText: cr?.text, repair: this.ledger.repair, damage: this.damage.value, toll: this.ledger.toll,
      newBadges: fresh.map((a) => ({ icon: a.icon, name: a.name })), rank: this.career.lastRank,
    }, () => { this.startRun(); });
  }

  /** ?people=1 — every variant in a row beside the start, cycling through actions (for screenshots). */
  debugPeopleLineup() {
    const all = [...VARIANTS, ...POLICE_VARIANTS, DRIVER_VARIANT, HELPER_VARIANT, HAWKER_VARIANT, CHADA_VARIANT];
    const actions: Action[] = ['idle', 'walk', 'sit', 'talk', 'point', 'wave', 'film', 'shield', 'megaphone', 'signal', 'phonecall', 'idle', 'talk', 'sit', 'signal', 'megaphone', 'idle', 'drive', 'hang', 'hawk', 'count'];
    all.forEach((v, i) => {
      const p = new Person(v);
      const f = this.road.sample(75 + (i % 11) * 1.4);
      const lat = i < 11 ? -6.5 : -9.5;
      p.position.set(f.x + f.rx * lat, 0, f.z + f.rz * lat);
      p.root.rotation.y = Math.atan2(f.rx, f.rz);
      p.setAction(actions[i % actions.length]);
      this.scene.add(p.root); this.people.add(p);
    });
  }

  // ---- Test / debug harness (window.__game) -------------------------------
  simulate(seconds: number, input: Partial<VehicleInput> & { autopilot?: boolean } = {}) {
    const h = 1 / PHYSICS.hz;
    const n = Math.round(seconds * PHYSICS.hz);
    const raw: VehicleInput = { throttle: 1, brake: 0, steer: 0, handbrake: false, ...input };
    for (let i = 0; i < n; i++) {
      if (input.autopilot) raw.steer = autopilotSteer(this.autopilotRoad ?? (this.onBranch ? this.fork.branch : this.road), this.onBranch && !this.autopilotRoad ? this.branchS : this.routeS, this.cur);
      if (input.autopilot && this.autopilotRoad === this.fork.branch) raw.steer = autopilotSteer(this.fork.branch, this.branchS, this.cur, -1.75, this.autopilotDir);
      this.physicsStep(h, raw);
      this.events.update(h, this.routeS, Math.abs(this.cur.v) * 3.6, this.elapsed);
      this.events.updateBranch(h, this.onBranch, this.branchS);
      this.blockade.update(h);
      this.incidents.update(h, this.routeS, Math.abs(this.cur.v) * 3.6, this.bus.root.position, this.cur.yaw);
      void this.fuel.update(h, this.routeS, Math.abs(this.cur.v) * 3.6, this.lateral, Math.abs(this.cur.v) * 3.6 < 2);
      this.incidentProps.update(h); this.eventProps.update(h);
      this.traffic.barrierS = this.blockade.active ? WORLD.andolonS - 1.2 : Infinity;
      this.traffic.laneBarrierS = this.eventProps.wreckClear ? Infinity : WORLD.accidentS - 8;
      if (i % 4 === 0) this.traffic.update(h * 4, this.routeS, this.lateral, this.cur.v, this.cam.camera.position, !this.onBranch);
      this.elapsed += h;
    }
    this.syncVisual(1); this.cam.snap();
    return this.stats();
  }
  teleportBranch(s: number, reverse = false) {
    const f = this.fork.branch.sample(s);
    const yaw = this.fork.branch.yawAt(s) + (reverse ? Math.PI : 0);
    const lane = reverse ? WORLD.laneWidth / 2 : -WORLD.laneWidth / 2;
    const st = createState(f.x + f.rx * lane, f.z + f.rz * lane, yaw);
    copyState(this.cur, st); copyState(this.prev, st); this.branchS = s; this.syncVisual(1); this.cam.snap();
  }
  teleport(s: number) {
    if (this.choice.open) this.choice.cancel(); // a pending prompt would hold the handbrake at the new spot
    const f = this.road.sample(s);
    const lane = -WORLD.laneWidth / 2;
    const st = createState(f.x + f.rx * lane, f.z + f.rz * lane, this.road.yawAt(s));
    copyState(this.cur, st); copyState(this.prev, st); this.routeS = s; this.branchS = 0; this.syncVisual(1); this.cam.snap();
  }
  stats() {
    return {
      kmh: Math.abs(this.cur.v) * 3.6, s: this.routeS, lateral: this.lateral, gear: this.cur.gear + 1, rpm: this.cur.rpm, mood: this.passengers.mood,
      zeroToSixty: this.debug.zeroToSixty, topSpeed: this.debug.topSpeed, onRoad: this.cur.onRoad, phase: this.events.phase,
      blockade: this.blockade.phase, fps: this.debug.fps, worstFrame: this.debug.worstFrame, spikes: this.debug.spikes, avgFrame: this.debug.avgFrame, tier: this.tier, cam: this.cam.mode,
      busProcedural: this.bus.isProcedural, passengers: this.passengers.count, elapsed: this.elapsed, onBranch: this.onBranch, branchS: this.branchS, wrongBranch: this.events.wrongBranch,
      colliders: COLLIDERS.count, screen: this.screen, paused: this.paused, cineTime: this.cinematic?.time ?? 0, cineActive: this.cinematic?.active ?? false, people: this.people.people.length, drawCalls: this.renderer.info.render.calls,
      fuel: this.fuel.fraction, fuelState: this.fuel.state, refuels: this.fuel.refuels, ledger: { ...this.ledger, net: this.ledger.net }, chada: [...this.incidents.chada], chadaRefused: this.incidents.chadaRefused,
      checkpoint: this.incidents.checkpoint, cameraDone: this.incidents.cameraDone, almsDone: this.incidents.almsDone, stopsDone: this.events.stopsDone, stops: this.events.stops.map((x) => ({ ...x })), choiceOpen: this.choice.open,
      career: { ...this.career.profile, level: this.career.level, title: this.career.title }, lastOutcome: this.lastOutcome, contract: this.contract?.id ?? null, lastContract: this.lastContract, crashes: this.crashes, lastBadges: this.lastBadges, rank: this.career.lastRank, damage: this.damage.value, mods: { ...MODS }, toll: this.incidents.toll, rail: this.incidents.rail, accident: this.incidents.accident, trainActive: this.eventProps.trainActive, roof: this.roof, ferryTaken: this.ferryTaken,
    };
  }
  renderAndRead(x: number, y: number, w: number, h: number) {
    this.syncVisual(1);
    if (this.freeCam) { this.cam.camera.position.copy(this.freeCam.pos); this.cam.camera.lookAt(this.freeCam.look); }
    else this.cam.update(this.bus.root, this.bus.body, 0, 0, 1 / 60, 0);
    const gl = this.renderer.getContext();
    const dpr = this.renderer.getPixelRatio();
    this.renderer.render(this.scene, this.cam.camera);
    const px = Math.round(x * dpr), pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    const py = Math.round(gl.drawingBufferHeight - (y + h) * dpr);
    const buf = new Uint8Array(pw * ph * 4);
    gl.readPixels(px, py, pw, ph, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let dark = 0, sum = 0;
    for (let i = 0; i < buf.length; i += 4) { const l = (buf[i] + buf[i + 1] + buf[i + 2]) / 3; sum += l; if (l < 28) dark++; }
    return { darkFraction: dark / (pw * ph), meanLuma: sum / (pw * ph) };
  }
  setFreeCamera(pos: [number, number, number] | null, look?: [number, number, number]) {
    if (!pos) { this.freeCam = null; return; }
    const base = this.bus.root.position;
    const yaw = this.bus.root.rotation.y;
    const rot = (v: [number, number, number]) => new THREE.Vector3(v[0], v[1], v[2]).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(base);
    this.freeCam = { pos: rot(pos), look: rot(look ?? [0, 1.6, 0]) };
  }
  driverHandError() {
    const d = this.bus.driver; if (!d) return null;
    this.bus.root.updateMatrixWorld(true);
    const hand = (i: number) => d.bones[i].getWorldPosition(new THREE.Vector3());
    const tgt = (v: THREE.Vector3 | null) => v ? d.root.localToWorld(v.clone()) : null;
    const l = tgt(d.ikL), r = tgt(d.ikR);
    return { left: l ? hand(7).distanceTo(l) : null, right: r ? hand(10).distanceTo(r) : null };
  }
  cockpitClearance() {
    const eye = new THREE.Vector3(CAMERA.cockpit.x, CAMERA.cockpit.y, CAMERA.cockpit.z).applyMatrix4(this.bus.body.matrixWorld);
    const ray = new THREE.Raycaster(); ray.near = 0.0; ray.far = 5;
    const meshes: THREE.Object3D[] = [];
    const visibleChain = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
    this.bus.root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !(m.material as THREE.Material).transparent && visibleChain(m) && !m.name.startsWith('person:')) meshes.push(m); });
    let min = Infinity; let forwardHit = Infinity;
    const q = this.bus.body.getWorldQuaternion(new THREE.Quaternion());
    for (let i = 0; i < 16; i++) for (const el of [-0.4, 0, 0.4]) {
      const a = (i / 16) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.sin(a) * Math.cos(el), Math.sin(el), -Math.cos(a) * Math.cos(el)).applyQuaternion(q);
      ray.set(eye, dir);
      const hit = ray.intersectObjects(meshes, false)[0];
      if (hit) { min = Math.min(min, hit.distance); if (i === 0 && el === 0) forwardHit = hit.distance; }
    }
    return { minDistance: min, forwardOpaqueHit: forwardHit };
  }
}

applyRoute(savedRouteId());
const game = new Game();
(window as unknown as { __game: Game }).__game = game;
game.init().catch((e) => { console.error(e); $('start-status').textContent = 'লোড করতে সমস্যা: ' + (e as Error).message; });
