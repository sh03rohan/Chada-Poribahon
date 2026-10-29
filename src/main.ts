import * as THREE from 'three';
import { PostStack, type PostLevel } from './render/post.ts';
import { Cascades } from './render/shadows.ts';

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
import { Weather, WEATHER_INFO, type WeatherKind } from './world/weather.ts';
import { PhotoMode } from './game/photo.ts';
import { CattleCrossing } from './world/cattle.ts';
import { Radio } from './game/radio.ts';
import { RiderEvents } from './game/riders.ts';
import { StreetLife } from './world/streetlife.ts';
import { SkyLife } from './world/skylife.ts';
import { Particles } from './world/particles.ts';
import { GlassRain } from './vehicle/glassRain.ts';
import { STORY, loadStory, saveStory, resetStory, judgeDay, verdict, describeDay, INSTALMENT, INSPECTOR_BONUS, INSPECTOR_PENALTY, type StoryDay } from './game/story.ts';
import { TrafficSignals } from './world/signals.ts';
import { BUSES, busDef } from './game/career.ts';
import { dailyChallenge, dateId, describeChallenge, recordChallenge, loadBook, challengeScore, shareText, challengeDateLabel, type Challenge } from './game/challenge.ts';
import { SPECIALS, describeOutcome, type ActiveSpecial, type SpecialDef, type SegmentMetrics } from './game/specials.ts';
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
  post: PostStack | null = null; cascades: Cascades | null = null;
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
  photo = new PhotoMode(); private photoFrom: 'driving' | 'pause' = 'driving';
  busDef = BUSES[0];
  radio = new Radio($('radio-ticker'));
  /** trip trace for the results card: (s, km/h) every 2 s and the moments worth marking */
  trace: { s: number; kmh: number }[] = []; traceEvents: { s: number; kind: 'stop' | 'crash' | 'fine' | 'fuel' }[] = []; private traceT = 0;
  riders!: RiderEvents; street!: StreetLife; skylife = new SkyLife(); particles = new Particles(600); glassRain!: GlassRain; private exhaustAcc = 0; private dustAcc = 0; private smokeAcc = 0;
  cattle!: CattleCrossing; highBeam = false; cowHits = 0; hazards = true; signals!: TrafficSignals; redLights = 0;
  /** daily challenge in progress (fixed route/hour/weather/contract) */
  story: StoryDay | null = null; lastStory: { day: number; met: boolean; points: number; note: string } | null = null;
  challenge: Challenge | null = null; private fixedHour: number | null = null; lastChallenge: { score: number; best: number; isBest: boolean; runs: number } | null = null;
  wiperPhase = 0; speedoTimer = 0; minimapTimer = 0; clockTimer = 0;
  lastFrame = performance.now();
  ready = false;
  private surf = { onRoad: true, wet: false, wallDistance: Infinity };
  private tmpV = new THREE.Vector3();
  private lastDt = 1 / 60;
  private lastCrash = -10; private crashPending = false; private crashKind: 'traffic' | 'object' | 'cow' | 'unlit' = 'traffic'; private crashImpact = 0;
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
  /** special passenger currently riding, how many have ridden this run, and a forced pick for tests */
  special: ActiveSpecial | null = null; specialsDone: { id: string; ok: boolean }[] = []; private forcedSpecial: string | null = null; horns = 0; private hornHeld = false;
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
    this.renderer.info.autoReset = false; // counted per frame across every post pass (reset in frame())
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
    this.input.onPause = () => { if (this.photo.on) { this.photo.close(); return; } if (this.screen === 'driving') this.togglePause(); };
    this.input.onPhoto = () => { if (this.screen === 'driving') this.openPhoto(); };
    this.input.onBeam = () => this.toggleHighBeam();
    this.input.onRadio = () => this.toggleRadio();
    $('btn-radio').onclick = () => this.toggleRadio();
    $('btn-beam').onclick = () => this.toggleHighBeam();
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
    this.cattle = new CattleCrossing(this.road, this.people, WORLD.cattleS); this.scene.add(this.cattle.group);
    this.signals = new TrafficSignals(this.road, WORLD.signalsS); this.scene.add(this.signals.group);
    this.street = new StreetLife(this.road, this.people, WORLD.stops.filter((x) => x.waiting > 0).map((x) => x.s), ROUTE.hawkerSpots); this.scene.add(this.street.group);
    this.scene.add(this.skylife.group); this.scene.add(this.particles.points);
    this.scene.add(this.cam.camera); this.glassRain = new GlassRain(this.cam.camera);
    // ?hazards=0: signals stay green and no cattle cross (deterministic ledger for the older tests)
    this.hazards = params.get('hazards') !== '0'; if (!this.hazards) this.signals.pin = 'green';
    this.incidentProps = new IncidentProps(this.road, this.people);
    this.eventProps = new EventProps(this.road, this.people); this.scene.add(this.eventProps.group);
    this.scene.add(this.incidentProps.group);
    this.sky = new SkySystem(this.renderer, this.scene, q.shadows, q.shadowMapSize);
    this.weather = new Weather(this.scene, q.rainCount);

    // bus model from the garage: dimensions for the body, axles / mass / torque / seats for the physics
    const bd = busDef(this.career.profile.bus);
    PHYSICS.lf = bd.lf; PHYSICS.lr = bd.lr; PHYSICS.wheelbase = bd.lf + bd.lr;
    MODS.mass = bd.massScale; MODS.busTorque = bd.torque; MODS.busGrip = bd.grip; MODS.busCapKmh = bd.capKmh;
    GAMEPLAY.seats = bd.seats; GAMEPLAY.initialPassengers = bd.initialPassengers;
    this.busDef = bd;
    this.bus = await loadBus({ anisotropy: maxAniso, shadows: q.shadows, people: this.people, dims: bd.dims });
    this.scene.add(this.bus.root);
    this.bus.setPassengers(this.passengers.count);
    this.events = new RouteEvents(this.blockade, this.passengers, this.hud, this.bus, this.ledger);
    this.fuel = new Fuel(this.hud, this.ledger, this.choice, this.passengers);
    this.damage = new Damage(this.bus, this.hud, this.passengers);
    this.incidents = new Incidents(this.incidentProps, this.passengers, this.hud, this.ledger, this.choice, this.events, this.scene, this.people); this.incidents.props3 = this.eventProps; this.incidents.onRoofCleared = () => this.clearRoof();
    this.map = new RouteMap(this.road, this.fork.branch, this.roundabouts.sideRoads);
    this.cinematic = new Cinematic(this.cineHost());

    // post-processing by tier (?post=none|basic|full overrides for A/B shots)
    const postParam = params.get('post'); const level: PostLevel = postParam === '0' || postParam === 'none' ? 'none' : postParam === 'basic' || postParam === 'full' ? postParam : q.post;
    if (level !== 'none') this.post = new PostStack(this.renderer, this.scene, this.cam.camera, level, innerWidth, innerHeight);
    // cascaded shadows on the high tier (?csm=0 to compare): the sky's sun stops casting, three cascades follow the camera
    if (this.tier === 'high' && q.shadows && params.get('csm') !== '0') {
      this.cascades = new Cascades(this.scene, this.cam.camera, this.sky.lightDir, q.shadowMapSize);
      this.sky.sun.castShadow = false; this.sky.cascadesOn = true; this.sky.sun.intensity = 0;
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
    { const urlW = this.urlWeather(); if (urlW) this.applyWeather(urlW, true); }
    this.cascades?.setupScene(this.scene);
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
    $('menu-start').onclick = async () => { await this.lockLandscape(); await this.audio.init(); this.audio.setVolume(this.settings.value.volume); if (BOOT_CHALLENGE && !this.challenge) this.startChallenge(BOOT_CHALLENGE); else if (BOOT_STORY && !this.story) this.startStory(BOOT_STORY); else if (this.settings.value.introSeen) this.showPretrip(); else this.playIntro(); };
    if (BOOT_STORY) $('menu-start').textContent = `📖 দিন ${bn(BOOT_STORY.day)}: ${BOOT_STORY.title}`;
    $('menu-story').onclick = () => this.openStory();
    if (BOOT_CHALLENGE) $('menu-start').textContent = '🗓️ চ্যালেঞ্জ শুরু';
    $('menu-challenge').onclick = () => this.openChallenge();
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
    $('pretrip-hint').textContent = `${WORLD.stops[0].name}তে থামুন, ${WORLD.stops[1]?.name ?? ROUTE.to}র কাছে অবরোধ হতে পারে, আর ${ROUTE.names.forkName}ে ভুল করবেন না — ${ROUTE.names.bridge}র রাস্তাই ${ROUTE.to}।`;
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
    $('pause-photo').onclick = () => this.openPhoto();
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
    const chal = this.challenge, story = this.story;
    ($('pretrip').querySelector('.route-select') as HTMLElement).classList.toggle('hidden', !!chal || !!story);
    $('pretrip-contracts').classList.toggle('hidden', !!chal || !!story);
    $('pretrip-challenge').classList.toggle('hidden', !chal);
    $('pretrip-story').classList.toggle('hidden', !story);
    if (story) { this.contractPick = () => CONTRACTS.find((c) => c.id === story.contract) ?? null; $('pretrip-story').innerHTML = `<b>📖 দিন ${bn(story.day)} / ৭ — ${story.title}</b><span class="story-owner">মালিক: ${story.owner}</span><span>${describeDay(story)}</span><small>${story.conditionText}${story.contract ? ` · 📜 কন্ট্রাক্ট: ${CONTRACTS.find((c) => c.id === story.contract)?.name ?? ''}` : ''}</small>`; }
    if (chal) { this.contractPick = () => chal.contract; const e = loadBook()[chal.id]; $('pretrip-challenge').innerHTML = `<b>🗓️ আজকের চ্যালেঞ্জ ${challengeDateLabel(chal.id)}</b><span>${describeChallenge(chal)}</span><small>${e ? `আপনার সেরা স্কোর ${bn(e.best)} (${bn(e.runs)} বার খেলেছেন)` : 'আজ এখনো খেলেননি — প্রথম চেষ্টা!'} · স্কোর = নিট আয় + তারা × ৫০০ + কন্ট্রাক্ট বোনাস</small>`; }
    else if (!story) this.contractPick = renderContractPicker($('pretrip-contracts'), dailyContracts(this.career.level), this.contract?.id ?? null);
    const h = this.clockHour(); const night = h < 6 || h >= 18;
    const rush = h >= GAMEPLAY.morningRushStart && h < GAMEPLAY.morningRushEnd;
    const effect = night ? 'রাত — হেডলাইট জ্বলবে, কুয়াশা, স্ট্যান্ডে যাত্রী কম' : rush ? 'সকালের অফিস টাইম — স্ট্যান্ডে যাত্রী দেড় গুণ' : 'দিন — স্বাভাবিক যাত্রী';
    ($('pretrip').querySelector('.clock-note') as HTMLElement).innerHTML = chal || story ? `🕒 <b>${story ? 'স্টোরির দিনের সময়' : 'চ্যালেঞ্জের সময় ঠিক করা'}:</b> ${bnClock(h)} — ${effect}` : `🕒 <b>আসল সময়ের দিন-রাত:</b> খেলার আলো আপনার ফোনের ঘড়ি অনুযায়ী চলে — এখন <span id="pretrip-clock">${bnClock(h)} (${effect})</span>। রাতে খেললে রাত, ভোরে খেললে ভোর।`;
    // today's weather: URL override, else drawn once per pre-trip (fog is likelier at night/dawn)
    const w = chal ? chal.weather : story?.weather ? story.weather : this.urlWeather() ?? this.rollWeather(night || h < 8);
    this.applyWeather(w, true);
    const wi = WEATHER_INFO[w];
    $('pretrip-weather').textContent = `${wi.icon} ${wi.name} — ${wi.effect}`;
  }
  private urlWeather(): WeatherKind | null {
    const w = params.get('weather');
    if (w === 'clear' || w === 'rain' || w === 'fog' || w === 'storm') return w;
    if (params.get('rain') === '1') return 'rain';
    return null;
  }
  private rollWeather(foggyHours: boolean): WeatherKind {
    const r = Math.random();
    const fogP = foggyHours ? 0.25 : 0.12;
    if (r < 0.52) return 'clear';
    if (r < 0.52 + 0.2) return 'rain';
    if (r < 0.52 + 0.2 + fogP) return 'fog';
    return 'storm';
  }
  /** Switch the whole scene to a weather kind: drops, sky/fog/exposure, lights, HUD icon. */
  applyWeather(kind: WeatherKind, instant = false) {
    this.weather.setKind(kind);
    if (instant) this.weather.wet = this.weather.raining ? 1 : 0;
    this.sky.setRain(this.weather.raining ? 1 : 0);
    this.sky.setFog(kind === 'fog' ? 1 : 0);
    this.sky.setStorm(kind === 'storm' ? 1 : 0);
    this.lightningIn = kind === 'storm' ? 2 + Math.random() * 4 : Infinity;
    $('btn-weather').textContent = WEATHER_INFO[kind].icon;
    this.applyNight();
  }
  private lightningIn = Infinity; private thunderIn = Infinity;
  /** Storm: flash the sky + overlay now and then, thunder rolls in a beat later. */
  private updateLightning(dt: number) {
    if (this.weather.storm && this.running && !this.paused) {
      this.lightningIn -= dt;
      if (this.lightningIn <= 0) {
        this.lightningIn = 5 + Math.random() * 11;
        this.sky.flash(1);
        const el = $('flash'); el.classList.add('on'); setTimeout(() => el.classList.remove('on'), 90);
        this.thunderIn = 0.4 + Math.random() * 1.4;
        this.lightningCount++;
      }
    }
    if (this.thunderIn !== Infinity) { this.thunderIn -= dt; if (this.thunderIn <= 0) { this.thunderIn = Infinity; this.audio.sting('thunder'); } }
    this.sky.tick(dt);
  }
  lightningCount = 0;

  // ---- Ambience + money stings ------------------------------------------------
  private ledgerSeen = { fines: 0, toll: 0, tips: 0 };
  /** Mix the ambient layers from where the bus is and what is going on; play a sting when the ledger moves. */
  private updateAmbience() {
    if (!this.audio.ready) return;
    const s = this.routeS, driving = this.screen === 'driving' && !this.paused;
    let crowd = 0, bell = 0, train = 0, siren = 0, water = 0;
    if (driving) {
      if (this.events.phase === 'stop') crowd = 1;
      else { const i = this.events.nextStop(s); if (i >= 0 && WORLD.stops[i].waiting > 0) { const d = Math.abs(WORLD.stops[i].s - s); crowd = Math.max(0, 0.6 * (1 - d / 90)); } }
      if (this.blockade.active && this.blockade.phase !== 'idle') { const d = Math.abs(WORLD.andolonS - s); crowd = Math.max(crowd, 1 - d / 140); if (this.blockade.phase === 'police') siren = Math.max(0, 1 - d / 160); }
      if (this.incidents.rail === 'closed') { const d = Math.abs(WORLD.railS - s); bell = Math.max(0, 1 - d / 160); }
      if (this.eventProps.trainActive) { const d = Math.abs(WORLD.railS - s), u = Math.abs(this.eventProps.trainOffset); train = Math.max(0, 1 - d / 260) * Math.max(0, 1 - u / 320); }
      if (s > WORLD.bridgeStartS && s < WORLD.bridgeEndS) water = 0.7; else if (this.onBranch) water = 0.35;
    }
    this.audio.setAmbience({ crowd, bell, train, siren, water });
    const L = this.ledger;
    if (L.fines > this.ledgerSeen.fines) { this.audio.sting('fail'); this.traceEvents.push({ s: this.routeS, kind: 'fine' }); }
    if (L.tips > this.ledgerSeen.tips) this.audio.sting('cash');
    if (L.toll > this.ledgerSeen.toll) this.audio.sting('ding');
    this.ledgerSeen = { fines: L.fines, toll: L.toll, tips: L.tips };
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
  private clockHour() { if (this.fixedHour !== null) return this.fixedHour; const h = params.get('hour'); if (h !== null) return parseFloat(h); const d = new Date(); return d.getHours() + d.getMinutes() / 60; }

  goToLanding() {
    this.togglePause(false); this.toggleMap(false);
    this.challenge = null; this.story = null; this.fixedHour = null;
    this.screen = 'landing'; this.running = false; this.hud.show(false); $('touch').classList.add('hidden'); $('minimap').classList.add('hidden');
    $('results').classList.add('hidden'); $('landing').classList.remove('hidden');
    this.refreshCareerChip();
    this.resetRun(); this.sky.setTime(6.3); this.applyNight();
  }

  // ---- Story mode ------------------------------------------------------------
  startStory(d: StoryDay) {
    if (ROUTE.id !== d.route) { try { localStorage.setItem('cp-story-pending', String(d.day)); } catch { /* ignore */ } const u = new URL(location.href); u.searchParams.delete('route'); u.searchParams.delete('story'); u.searchParams.delete('challenge'); location.href = u.toString(); return; }
    this.challenge = null; this.story = d; this.fixedHour = d.hour; this.lastStory = null;
    $('story').classList.add('hidden');
    this.showPretrip();
  }
  openStory() {
    const p = loadStory();
    const cards = STORY.map((d) => { const r = p.results[d.day - 1]; const cls = r ? 'done' : d.day === p.day && !p.finished ? 'today' : 'locked'; return `<div class="sday ${cls}"><b>দিন ${bn(d.day)}: ${d.title}</b>${describeDay(d)}<small>${d.conditionText}</small>${r ? `<small>${r.note} · ${'★'.repeat(r.stars)} · ${bn(r.points)} পয়েন্ট</small>` : ''}</div>`; }).join('');
    const today = STORY[Math.min(p.day, 7) - 1];
    const head = p.finished && p.ending ? `<p class="story-verdict"><b>${p.ending.split('\n')[0]}</b>${p.ending.split('\n')[1] ?? ''}</p>` : `<p class="hint">মালিকের বাসে সাত দিনের চাকরি। প্রতিদিনের টার্গেট পূরণে ১ পয়েন্ট, ৪+ তারায় ½, ০ জরিমানায় ½। সাত দিন পর মালিকের রায়।</p><p class="story-owner">দিন ${bn(today.day)} — মালিক: ${today.owner}</p>`;
    $('story-body').innerHTML = head + `<div class="story-days">${cards}</div>`;
    $('story-play').textContent = p.finished ? 'আবার সাত দিন খেলুন' : `দিন ${bn(today.day)} খেলুন`;
    $('story').classList.remove('hidden');
    $('story-play').onclick = async () => { await this.lockLandscape(); await this.audio.init(); this.audio.setVolume(this.settings.value.volume); if (p.finished) { resetStory(); this.startStory(STORY[0]); } else this.startStory(today); };
    $('story-reset').onclick = () => { resetStory(); this.openStory(); };
    $('story-close').onclick = () => $('story').classList.add('hidden');
  }
  // ---- Daily challenge --------------------------------------------------------
  /** Enter challenge mode: fixed hour + weather + contract on the challenge's route, then the pre-trip card. */
  startChallenge(c: Challenge) {
    if (ROUTE.id !== c.routeId) { try { localStorage.setItem('cp-challenge-pending', c.id); } catch { /* ignore */ } const u = new URL(location.href); u.searchParams.delete('route'); u.searchParams.delete('challenge'); location.href = u.toString(); return; }
    this.challenge = c; this.fixedHour = c.hour; this.lastChallenge = null;
    $('challenge').classList.add('hidden');
    this.showPretrip();
  }
  /** Main-menu panel: today's conditions, your best, and the last days' scores. */
  openChallenge() {
    const c = dailyChallenge(); const book = loadBook(); const today = book[c.id];
    const days = Object.keys(book).sort().reverse().slice(0, 7);
    $('challenge-body').innerHTML = `<p class="chal-today"><b>🗓️ ${challengeDateLabel(c.id)}</b> — ${describeChallenge(c)}</p>
      <p class="hint">সবার জন্য একই রুট, সময়, আবহাওয়া আর কন্ট্রাক্ট — দিনে যতবার খুশি চেষ্টা করুন, সেরা স্কোরটা থাকবে। স্কোর = নিট আয় + তারা × ৫০০ + কন্ট্রাক্ট বোনাস।</p>
      <p class="chal-best">${today ? `আপনার আজকের সেরা: <b>${bn(today.best)}</b> (${bn(today.runs)} বার)` : 'আজ এখনো খেলেননি'}</p>` +
      (days.length ? `<table class="runs"><thead><tr><th>তারিখ</th><th>সেরা স্কোর</th><th>নিট</th><th>তারা</th><th>চেষ্টা</th></tr></thead><tbody>${days.map((d) => `<tr class="${d === c.id ? 'latest' : ''}"><td>${challengeDateLabel(d)}</td><td><b>${bn(book[d].best)}</b></td><td>${bnTaka(book[d].net)}</td><td>${'★'.repeat(book[d].stars)}</td><td>${bn(book[d].runs)}</td></tr>`).join('')}</tbody></table>` : '');
    $('challenge').classList.remove('hidden');
    $('challenge-play').onclick = async () => { await this.lockLandscape(); await this.audio.init(); this.audio.setVolume(this.settings.value.volume); this.startChallenge(c); };
    $('challenge-close').onclick = () => $('challenge').classList.add('hidden');
  }
  /** Photo mode: pause, hide every HUD layer and hand the camera to the orbit. */
  openPhoto() {
    if (this.photo.on || this.screen !== 'driving') return;
    this.photoFrom = this.paused ? 'pause' : 'driving';
    this.paused = true; $('pause').classList.add('hidden'); $('fullmap').classList.add('hidden');
    this.hud.show(false); $('minimap').classList.add('hidden'); $('touch').classList.add('hidden'); $('crack').classList.add('hidden');
    this.photo.open({
      busPos: () => this.bus.root.position.clone(),
      setFreeCam: (pos, look, fov) => { this.freeCam = { pos, look, fov }; },
      renderClean: () => { this.photo.update(); this.cam.camera.position.copy(this.freeCam!.pos); this.cam.camera.lookAt(this.freeCam!.look); this.cam.camera.fov = 45; this.cam.camera.updateProjectionMatrix(); if (this.post) this.post.render(); else this.renderer.render(this.scene, this.cam.camera); return this.renderer.domElement; },
      hour: () => this.sky.state.hour,
      onClose: () => {
        this.freeCam = null; this.cam.snap();
        this.hud.show(true); $('minimap').classList.remove('hidden');
        if (isMobile() || params.get('touch') === '1') $('touch').classList.remove('hidden');
        if (this.photoFrom === 'pause') $('pause').classList.remove('hidden'); else this.paused = false;
      },
    });
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
    this.events.onStopBegin = (i) => { this.settleSpecial(i); this.beginBoarding(i); };
    this.events.onStopEnd = (i) => this.endBoarding(i);
    if (this.incidents) this.incidents.reset();
    this.incidents = new Incidents(this.incidentProps, this.passengers, this.hud, this.ledger, this.choice, this.events, this.scene, this.people); this.incidents.props3 = this.eventProps; this.incidents.onRoofCleared = () => this.clearRoof();
    this.fuel = new Fuel(this.hud, this.ledger, this.choice, this.passengers);
    this.riders = new RiderEvents(this.choice, this.hud, this.ledger, this.passengers, this.events); if (!this.hazards) this.riders.chance = 0;
    this.crashes = 0; this.fuelEmptied = false; this.ledgerSeen = { fines: 0, toll: 0, tips: 0 }; this.trace = []; this.traceEvents = []; this.traceT = 0; this.cattle?.reset(); this.cowHits = 0; this.signals?.reset(); this.redLights = 0; if (this.highBeam) this.toggleHighBeam(false); this.special = null; this.specialsDone = []; this.horns = 0; this.hornHeld = false; this.setGoalPill(null);
    this.ferryTaken = false; this.ferryOffered = false; this.roofOffered = false; this.clearRoof();
    this.damage = new Damage(this.bus, this.hud, this.passengers); this.damage.reset();
    this.fuel.litres = GAMEPLAY.fuelTankLitres * (GAMEPLAY.fuelStartFraction[0] + Math.random() * (GAMEPLAY.fuelStartFraction[1] - GAMEPLAY.fuelStartFraction[0])); // the owner never fills it
    const hr = this.clockHour(); this.events.waitingMultiplier = (hr >= GAMEPLAY.morningRushStart && hr < GAMEPLAY.morningRushEnd ? 1.5 : (hr >= 21 || hr < 5) ? 0.5 : 1) * (this.story?.crowd ?? 1);
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
    if (this.weather.kind !== 'clear') { const wi = WEATHER_INFO[this.weather.kind]; this.toast(`${wi.icon} আজ ${wi.name}: ${wi.effect}`, 8000); }
    if (this.sky.state.night) this.toast('🌙 রাতে বাতি-ছাড়া ট্রাক-ভ্যান থাকে — L / 🔦 হাই বিম দিন, কিন্তু সামনে গাড়ি এলে নামান', 9000);
    this.bus.setCockpitMode(this.cam.mode === 'cockpit');
    this.tutorialStep = this.settings.value.tutorialSeen ? 99 : 0; this.tutorialTimer = 0;
    this.helperShout();
  }

  switchCamera(mode?: CameraMode) {
    if (mode) this.cam.setMode(mode); else this.cam.next();
    this.bus.setCockpitMode(this.cam.mode === 'cockpit');
  }

  toggleWeather() {
    const kind = this.weather.next();
    this.applyWeather(kind);
    const wi = WEATHER_INFO[kind];
    this.hud.message(`${wi.icon} ${wi.name} — ${wi.effect}`, kind === 'clear', 2500);
  }

  /** Radio: cycles off → three stations → off; remembered in settings, attached to the audio graph on first init. */
  toggleRadio() {
    if (!this.audio.ready) return;
    this.ensureRadio();
    const label = this.radio.cycle();
    this.settings.set('radio', this.radio.on ? this.radio.station : -1);
    $('btn-radio').classList.toggle('on', this.radio.on);
    if (this.screen === 'driving') this.hud.message(label, true, 2200);
  }
  private radioAttached = false;
  private ensureRadio() {
    if (this.radioAttached || !this.audio.context) return;
    this.radio.attach(this.audio.context, this.audio.radioBus); this.radioAttached = true;
    const saved = this.settings.value.radio;
    if (saved >= 0) { this.radio.set(saved); $('btn-radio').classList.add('on'); }
  }
  /** High beam: longer headlight cones for spotting unlit vehicles and cattle; oncoming traffic flashes back. */
  toggleHighBeam(force?: boolean) {
    this.highBeam = force ?? !this.highBeam;
    this.bus.setHighBeam?.(this.highBeam); this.traffic.highBeam = this.highBeam;
    $('btn-beam').classList.toggle('on', this.highBeam);
    if (this.screen === 'driving') this.hud.message(this.highBeam ? '🔦 হাই বিম চালু — সামনের গাড়ি ঝলসে যাচ্ছে, কাছে এলে নামান' : '🔦 লো বিম', true, 1800);
  }
  applyNight() {
    const night = this.sky.state.night;
    this.props.setNight(night); this.roundabouts?.setNight(night); this.traffic.setNight(night); this.street?.apply(this.sky.state.hour);
    $('btn-beam').classList.toggle('hidden', !night);
    this.bus.setLights({ headlights: night || this.weather.wet > 0.5 || this.weather.fog, brake: this.cur.brake, reverse: this.cur.v < -0.2 });
  }

  resize() {
    this.renderer.setSize(innerWidth, innerHeight, false);
    this.post?.setSize(innerWidth, innerHeight); this.cascades?.resize();
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
      this.cattle.circles(this.routeS, this.dynCircles);
      const col = resolveBusCollisions(this.cur, this.dynCircles, this.colScratch, this.contacts);
      if (col.contacts.length) { this.traffic.applyContacts(col.contacts); this.cattle.applyContacts(col.contacts.filter((c) => this.cattle.isCow(c.circle.tag))); }
      if (col.hit && col.impact > 2.0 && this.simTime - this.lastCrash > 2.5) { this.lastCrash = this.simTime; /* sim time: counts in scripted runs too */ this.crashPending = true; this.crashes++; this.crashKind = col.contacts.some((c) => this.cattle.isCow(c.circle.tag)) ? 'cow' : col.contacts.some((c) => c.into > 1 && (c.circle.tag as { unlit?: boolean })?.unlit && this.sky.state.night) ? 'unlit' : col.contacts.some((c) => c.into > 1) ? 'traffic' : 'object'; this.crashImpact = col.impact; }
    }
    this.simTime += dt;
    if (this.running && !this.finished && !this.onBranch && this.elapsed - this.traceT >= 2) { this.traceT = this.elapsed; this.trace.push({ s: this.routeS, kmh: Math.abs(this.cur.v) * 3.6 }); }
    this.debug.physicsSample(this.cur.v * 3.6, inp.throttle, this.simTime);
  }

  frames = 0;
  frame(now: number) {
    requestAnimationFrame((t) => this.frame(t)); this.frames++; this.renderer.info.reset();
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
        this.damage.hit(this.crashImpact, this.crashKind === 'cow' ? 'object' : this.crashKind === 'unlit' ? 'traffic' : this.crashKind);
        if (this.crashKind === 'cow') { this.cowHits++; this.ledger.fines += GAMEPLAY.cowFine; this.passengers.mood = Math.max(0, this.passengers.mood - 12); }
        this.hud.message(this.crashKind === 'cow' ? `গরুকে ধাক্কা! মালিক রেগে গেছে — ক্ষতিপূরণ ${bnTaka(GAMEPLAY.cowFine)}` : this.crashKind === 'unlit' ? 'বাতি-ছাড়া গাড়িতে ধাক্কা! রাতে হাই বিম (L) দিন' : this.crashKind === 'traffic' ? 'সামনের গাড়িতে ধাক্কা! সাবধানে!' : 'ধাক্কা লেগেছে! রাস্তায় থাকুন');
        this.passengers.shout(this.crashKind === 'traffic' || this.crashKind === 'unlit' ? 'brake' : 'swerve', true);
        this.audio.sting('crash'); this.radio.duck(2); this.traceEvents.push({ s: this.routeS, kind: 'crash' });
      }
    }
    // Real-time clock: re-read the device time once a minute so the sky keeps moving during a trip
    if (this.screen === 'driving' && params.get('hour') === null && this.fixedHour === null) {
      this.clockTimer += dt;
      if (this.clockTimer > 60) { this.clockTimer = 0; const h = this.clockHour(); if (Math.abs(h - this.sky.state.hour) > 1 / 120) { this.sky.setTime(h); this.applyNight(); } }
    }
    if (!this.paused) {
      this.blockade.update(dt);
      this.traffic.barrierS = this.blockade.active ? WORLD.andolonS - 1.2 : Infinity;
      this.traffic.laneBarrierS = this.eventProps.wreckClear ? Infinity : WORLD.accidentS - 8;
      this.traffic.update(dt, this.routeS, this.lateral, this.cur.v, this.cam.camera.position, this.running && !this.finished && !this.onBranch && !this.cinematicMode);
      this.people.update(dt, this.cam.camera.position);
      this.incidentProps.update(dt); this.eventProps.update(dt); this.updateCattle(dt); this.updateSignals(dt);
      this.stops.update(this.elapsed, this.routeS);
    }

    // ---- visuals -------------------------------------------------------------
    this.syncVisual(alpha);
    const rough = this.cur.onRoad ? 0.15 : 1;
    if (this.screen === 'landing') this.landingCamera(dt);
    this.photo.update();
    if (this.freeCam) { this.cam.camera.position.copy(this.freeCam.pos); this.cam.camera.lookAt(this.freeCam.look); if (this.freeCam.fov) { this.cam.camera.fov = this.freeCam.fov; this.cam.camera.updateProjectionMatrix(); } }
    else this.cam.update(this.bus.root, this.bus.body, kmh, rough, dt, this.cur.aLat);
    this.sky.follow(this.bus.root.position);
    this.props.tick(dt); this.skylife.update(dt, this.bus.root.position, this.tmpV.set(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw)), this.sky.state.hour);
    this.updateParticles(dt, kmh);
    this.glassRain.update(dt, this.weather.wet, this.wiperPhase, this.cam.mode === 'cockpit');
    if (this.cascades) this.cascades.update(this.sky.lightDir, this.sky.sun.color, this.sky.sunIntensity);
    this.bus.setBeamCones?.(this.sky.state.night ? 0.16 + this.sky.state.fog * 0.3 + this.weather.wet * 0.08 : this.sky.state.fog * 0.3);
    const vel = this.tmpV.set(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw)).multiplyScalar(this.cur.v);
    this.weather.update(dt, this.cam.camera.position, vel);
    this.road.setWet(this.weather.wet);
    const night = this.sky.state.night;
    this.bus.setLights({ headlights: night || this.weather.wet > 0.5 || this.weather.fog, brake: this.cur.brake, reverse: this.cur.v < -0.2 });
    this.updateLightning(dt);
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
    if (this.running && raw.horn && !this.hornHeld) this.horns++; this.hornHeld = raw.horn;
    this.updateAmbience();
    if (this.audio.ready) { this.ensureRadio(); if (raw.horn && this.running) this.radio.duck(1.2); this.radio.update(dt, { weather: this.weather.kind, hour: this.sky.state.hour, routeS: this.routeS }); }
    if (this.special) this.special.maxKmh = Math.max(this.special.maxKmh, kmh);
    if (this.screen === 'driving' && this.running && !this.paused && !this.finished) this.riders.update(dt, kmh, this.events.phase, this.choice.open);

    // rear-view mirror (cockpit only, every other frame)
    if (this.mirrorTarget && this.mirrorCam && this.cam.mode === 'cockpit' && !this.freeCam && (this.debug.frameCount & 1) === 0) {
      this.bus.body.updateMatrixWorld(true);
      this.mirrorCam.position.set(0.1, 2.7, -5.0).applyMatrix4(this.bus.body.matrixWorld);
      const back = new THREE.Vector3(0.1, 2.2, 20).applyMatrix4(this.bus.body.matrixWorld);
      this.mirrorCam.lookAt(back);
      this.renderer.setRenderTarget(this.mirrorTarget); this.renderer.render(this.scene, this.mirrorCam); this.renderer.setRenderTarget(null);
    }

    if (this.post) { const hr = this.sky.state.hour; this.post.setMood(this.sky.state.night, this.sky.state.fog, this.weather.kind === 'clear' && hr > 11 && hr < 15.5 ? 1 : 0, this.simTime); this.post.render(); } else this.renderer.render(this.scene, this.cam.camera);
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
    this.maybeBoardSpecial(i); this.traceEvents.push({ s: WORLD.stops[i].s, kind: 'stop' });
    if (this.screen === 'driving') void this.riders.onStopEnd(i, this.events.stops[i].boarded);
  }

  private updateSignals(dt: number) {
    this.signals.update(dt);
    this.traffic.stopLines = this.signals.stopLines(this.traffic.stopLines);
    if (this.onBranch || !this.running || this.finished) return;
    const r = this.signals.check(this.routeS, Math.abs(this.cur.v) * 3.6);
    if (this.screen !== 'driving') return;
    if (r.ahead) this.hud.message('🚦 সামনে ট্রাফিক সিগন্যাল — লাল হলে সাদা দাগে থামুন', true, 3500);
    if (r.ran) { this.redLights++; this.ledger.fines += GAMEPLAY.redLightFine; this.passengers.mood = Math.max(0, this.passengers.mood - 6); this.hud.message(`🚦 লাল বাতিতে পার! ট্রাফিক পুলিশের জরিমানা ${bnTaka(GAMEPLAY.redLightFine)}`, false, 4500); this.passengers.shout('brake', true); }
    if (r.stopped) { this.passengers.mood = Math.min(100, this.passengers.mood + 2); this.hud.message('🚦 লাল বাতিতে থেমেছেন — সবুজ হলে চলুন', true, 3000); }
  }
  /** exhaust by throttle, dust off the shoulder, spray in rain, smoke from the tea stalls */
  private updateParticles(dt: number, kmh: number) {
    const yaw = this.cur.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const b = this.bus.root.position, half = this.busDef.dims.length / 2;
    if (this.running && !this.paused) {
      this.exhaustAcc += dt * (3 + this.cur.throttle * 14 + (this.damage.value > 50 ? 6 : 0));
      while (this.exhaustAcc >= 1) { this.exhaustAcc -= 1; const ex = b.x - fx * (half - 0.1) - rx * 0.9, ez = b.z - fz * (half - 0.1) - rz * 0.9; this.particles.emit(ex, 0.4, ez, -fx * 1.5 + (Math.random() - 0.5), 0.9 + Math.random() * 0.6, -fz * 1.5 + (Math.random() - 0.5), 1.4 + Math.random(), 0.35, 0.9, 0x6a6a66, 0.22 + this.cur.throttle * 0.18); }
      const offRoad = !this.cur.onRoad || Math.abs(this.lateral) > WORLD.roadWidth / 2 + 0.3;
      if (kmh > 8 && (offRoad || this.weather.wet > 0.4)) {
        this.dustAcc += dt * kmh * 0.35;
        while (this.dustAcc >= 1) { this.dustAcc -= 1; const side = Math.random() < 0.5 ? -1 : 1; const wx = b.x - fx * PHYSICS.lr + rx * side * 1.05, wz = b.z - fz * PHYSICS.lr + rz * side * 1.05;
          if (this.weather.wet > 0.4 && !offRoad) this.particles.emit(wx, 0.3, wz, -fx * 3 + rx * side * 1.2, 1.2 + Math.random(), -fz * 3 + rz * side * 1.2, 0.5 + Math.random() * 0.3, 0.3, 1.2, 0xdfe8f2, 0.3);
          else this.particles.emit(wx, 0.2, wz, -fx * 2 + (Math.random() - 0.5) * 2, 0.6 + Math.random() * 0.8, -fz * 2 + (Math.random() - 0.5) * 2, 1.6 + Math.random(), 0.5, 1.6, 0xc9b58a, 0.28); }
      }
    }
    if (this.street.active.includes('tea')) {
      this.smokeAcc += dt * 6;
      while (this.smokeAcc >= 1) { this.smokeAcc -= 1; for (const p of this.street.teaSpots) if (p.distanceToSquared(b) < 140 * 140) this.particles.emit(p.x, p.y, p.z, (Math.random() - 0.5) * 0.2, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.2, 2.5 + Math.random(), 0.3, 0.45, 0xd8d4cc, 0.35); }
    }
    this.particles.update(dt, 0.3, 0.1);
  }
  private updateCattle(dt: number) {
    if (this.onBranch || !this.running || !this.hazards) return;
    const r = this.cattle.update(dt, this.routeS);
    if (r.started && this.screen === 'driving') { this.hud.message('🐄 সামনে গরু পার হচ্ছে — আস্তে, থামুন!', false, 5000); this.passengers.shout('brake', true); }
  }
  // ---- Special passengers ---------------------------------------------------
  forceSpecial(id: string | null) { this.forcedSpecial = id; }
  private segmentMetrics(): SegmentMetrics {
    const sm = this.passengers.summary;
    return { timeSec: this.elapsed, distM: this.routeS, hardBrakes: sm.hardBrakes, swerves: sm.swerves, fines: this.ledger.fines, crashes: this.crashes, horns: this.horns, maxKmh: 0, mood: this.passengers.mood };
  }
  private setGoalPill(text: string | null) {
    const el = $('hud-goal'); document.body.classList.toggle('has-goal', !!text); if (!text) { el.classList.add('hidden'); return; }
    el.textContent = text; el.classList.remove('hidden');
  }
  /** After the regular boarding at stop i: sometimes a special passenger climbs on with a request for the next leg. */
  private maybeBoardSpecial(i: number) {
    if (this.special || this.screen !== 'driving') return;
    const next = WORLD.stops.slice(i + 1).find((st) => st.s > this.routeS + 300);
    if (!next) return;
    let def: SpecialDef | undefined;
    if (this.forcedSpecial) { def = SPECIALS.find((d) => d.id === this.forcedSpecial); this.forcedSpecial = null; }
    else {
      if (this.specialsDone.length >= GAMEPLAY.specialMaxPerRun || Math.random() > GAMEPLAY.specialChance) return;
      const unused = SPECIALS.filter((d) => !this.specialsDone.some((x) => x.id === d.id));
      def = unused[Math.floor(Math.random() * unused.length)];
    }
    if (!def) return;
    const distM = next.s - this.routeS;
    this.special = { def, boardStop: i, start: this.segmentMetrics(), maxKmh: 0 };
    // the figure: appears by the shed and walks to the door
    const right = new THREE.Vector3(Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw));
    const fwd = new THREE.Vector3(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw));
    const door = new THREE.Vector3(this.bus.root.position.x, 0, this.bus.root.position.z).addScaledVector(right, -2.2).addScaledVector(fwd, 4.0);
    const p = new Person(VARIANTS[def.variant]); p.position.copy(this.stops.shedFront[i]).addScaledVector(fwd, 1.5); p.walkSpeed = 1.3;
    this.scene.add(p.root); this.people.add(p);
    p.walkTo(door, 'queue', () => { this.scene.remove(p.root); this.people.remove(p); });
    this.passengers.count = Math.min(GAMEPLAY.seats, this.passengers.count + 1); this.bus.setPassengers(this.passengers.count);
    this.hud.bubble({ kind: 'good', text: `${def.icon} ${def.name}: ${def.greet}` });
    this.toast(`${def.icon} ${def.name} উঠলেন — ${def.goal({ distM })} → বকশিশ ${bnTaka(def.tip)}`, 9000);
    this.setGoalPill(`${def.icon} ${def.goal({ distM })}`);
  }
  /** Called when the bus stops at a later stop, or at the finish: judge the leg and pay (or not). */
  private settleSpecial(i: number, atFinish = false) {
    const sp = this.special; if (!sp || (!atFinish && i <= sp.boardStop)) return;
    this.special = null;
    const now = this.segmentMetrics();
    const m: SegmentMetrics = { timeSec: now.timeSec - sp.start.timeSec, distM: now.distM - sp.start.distM, hardBrakes: now.hardBrakes - sp.start.hardBrakes, swerves: now.swerves - sp.start.swerves,
      fines: now.fines - sp.start.fines, crashes: now.crashes - sp.start.crashes, horns: now.horns - sp.start.horns, maxKmh: sp.maxKmh, mood: now.mood };
    const ok = sp.def.check(m);
    this.specialsDone.push({ id: sp.def.id, ok });
    if (ok) { this.ledger.tips += sp.def.tip; this.passengers.mood = Math.min(100, this.passengers.mood + 4); }
    else { this.passengers.mood = Math.max(0, this.passengers.mood - 8); this.audio.sting('fail'); }
    this.hud.bubble({ kind: ok ? 'good' : 'wait', text: `${sp.def.icon} ${sp.def.name}: ${ok ? sp.def.thanks : sp.def.sorry}` });
    this.toast(describeOutcome(sp.def, ok), 7000);
    this.setGoalPill(null);
    if (!atFinish) {
      // step off and walk to the shed
      const right = new THREE.Vector3(Math.cos(this.cur.yaw), 0, -Math.sin(this.cur.yaw));
      const fwd = new THREE.Vector3(-Math.sin(this.cur.yaw), 0, -Math.cos(this.cur.yaw));
      const door = new THREE.Vector3(this.bus.root.position.x, 0, this.bus.root.position.z).addScaledVector(right, -2.2).addScaledVector(fwd, 4.0);
      const p = new Person(VARIANTS[sp.def.variant]); p.position.copy(door).addScaledVector(right, -0.3); p.walkSpeed = 1.2;
      this.scene.add(p.root); this.people.add(p);
      p.walkTo(this.stops.shedFront[i].clone().addScaledVector(fwd, 2.5), 'idle', () => setTimeout(() => { this.scene.remove(p.root); this.people.remove(p); }, 8000));
      this.passengers.count = Math.max(0, this.passengers.count - 1); this.bus.setPassengers(this.passengers.count);
    }
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
    this.settleSpecial(-1, true);
    const sm = this.passengers.summary;
    this.ledger.repair = this.damage.repairCost;
    if (this.story) {
      const smx = this.passengers.summary;
      if (this.story.condition === 'instalment') this.ledger.owner -= INSTALMENT;
      if (this.story.condition === 'inspector') this.ledger.owner += this.ledger.fines === 0 && smx.hardBrakes <= 2 ? INSPECTOR_BONUS : -INSPECTOR_PENALTY;
    }
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
      damage: this.damage.value, ferry: this.ferryTaken, roof: this.roof, night: hr >= 20 || hr < 5, contractDone: !!cr?.done, refuels: this.fuel.refuels, hardBrakes: sm.hardBrakes, tips: this.ledger.tips,
    }, this.career.profile, this.career.level);
    this.career.save(); this.lastBadges = fresh.map((a) => a.id);
    let challengeText: string | undefined, challengeShare: string | undefined;
    if (this.challenge) {
      const score = challengeScore(this.ledger.net, this.passengers.stars(), cr?.done ? cr.def.bonus : 0);
      const rec = recordChallenge(this.challenge.id, score, this.ledger.net, this.passengers.stars(), this.elapsed);
      this.lastChallenge = { score, best: rec.entry.best, isBest: rec.isBest, runs: rec.entry.runs };
      challengeText = `🗓️ চ্যালেঞ্জ স্কোর <b>${bn(score)}</b>${rec.isBest ? ' — আজকের নতুন সেরা! 🎉' : ` (আজকের সেরা ${bn(rec.entry.best)})`}`;
      challengeShare = shareText(this.challenge, score, this.ledger.net, this.passengers.stars());
    }
    let storyText: string | undefined;
    if (this.story) {
      const d = this.story, p = loadStory();
      const res = judgeDay(d, { net: this.ledger.net, stars: this.passengers.stars(), fines: this.ledger.fines, hardBrakes: sm.hardBrakes, crashes: this.crashes });
      p.results[d.day - 1] = res; p.results.length = d.day;
      if (d.day >= 7) { const v = verdict(p.results); p.finished = true; p.ending = `${v.title}\n${v.text}`; p.day = 7; storyText = `📖 দিন ৭ শেষ — ${res.note}<br>${v.title}<br><small>${v.text}</small>`; }
      else { p.day = d.day + 1; p.finished = false; p.ending = null; storyText = `📖 দিন ${bn(d.day)}: ${res.note} · ${bn(res.points)} পয়েন্ট${d.condition === 'instalment' ? ` · কিস্তি ${bnTaka(INSTALMENT)} কাটা` : ''}${d.condition === 'inspector' ? ` · ইন্সপেক্টরের রিপোর্ট ${this.ledger.owner > 0 ? 'ভালো ✅' : 'খারাপ ❌'}` : ''} — কাল দিন ${bn(d.day + 1)}: ${STORY[d.day].title}`; }
      saveStory(p); this.lastStory = { day: d.day, met: res.met, points: res.points, note: res.note };
    }
    this.audio.setAmbience({ crowd: 0, bell: 0, train: 0, siren: 0, water: 0 });
    if (outcome.levelUp) setTimeout(() => this.audio.sting('levelup'), 600); else if (fresh.length || cr?.done) setTimeout(() => this.audio.sting('badge'), 600);
    showResults({
      timeSec: this.elapsed, passengers: this.passengers.count, income: this.events.income, mood: this.passengers.mood,
      stars: this.passengers.stars(), shouts: sm.shouts, hardBrakes: sm.hardBrakes, swerves: sm.swerves, stoppedAtRajbari: this.events.stoppedAtRajbari,
      stopsDone: this.events.stopsDone, stopsTotal: WORLD.stops.filter((x) => x.waiting > 0).length, fares: this.ledger.fares, fines: this.ledger.fines, chada: this.ledger.chada, fuel: this.ledger.fuel, charity: this.ledger.charity,
      career: outcome, contractText: cr?.text, repair: this.ledger.repair, damage: this.damage.value, toll: this.ledger.toll, tips: this.ledger.tips,
      newBadges: fresh.map((a) => ({ icon: a.icon, name: a.name })), rank: this.career.lastRank, challengeText, challengeShare, storyText, owner: this.ledger.owner, againLabel: this.story ? (loadStory().finished ? '📖 মালিকের রায় দেখুন' : `📖 পরের দিন (${bn(Math.min(7, (this.story.day) + 1))})`) : undefined,
    }, () => { if (this.story) { const p = loadStory(); if (p.finished) { this.goToLanding(); this.openStory(); } else this.startStory(STORY[p.day - 1]); } else this.startRun(); });
    this.map.drawTrace($('res-trace') as HTMLCanvasElement, this.trace, this.traceEvents);
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
      this.incidentProps.update(h); this.eventProps.update(h); this.updateCattle(h); this.updateSignals(h);
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
      career: { ...this.career.profile, level: this.career.level, title: this.career.title }, lastOutcome: this.lastOutcome, contract: this.contract?.id ?? null, lastContract: this.lastContract, crashes: this.crashes, lastBadges: this.lastBadges, rank: this.career.lastRank, damage: this.damage.value, mods: { ...MODS }, toll: this.incidents.toll, rail: this.incidents.rail, accident: this.incidents.accident, trainActive: this.eventProps.trainActive, roof: this.roof, ferryTaken: this.ferryTaken, weather: this.weather.kind, wet: this.weather.wet, special: this.special ? this.special.def.id : null, bus: this.busDef.id, seats: GAMEPLAY.seats, highBeam: this.highBeam, unlit: this.traffic.unlitCount, cattle: this.cattle.spots.map((x) => ({ s: x.s, state: x.state, lats: x.cows.map((c) => +c.lat.toFixed(1)) })), cowHits: this.cowHits, riders: { log: this.riders.log, pendingDrop: this.riders.pendingDrop }, street: { bands: this.street.active, counts: this.street.counts() }, post: this.post?.level ?? 'none', skyBakes: this.sky.bakes, particles: this.particles.alive, glassRain: this.glassRain.visible, trace: this.trace.length, traceEvents: this.traceEvents.length, csm: !!this.cascades, raysOpacity: (this.sky as unknown as { rays: THREE.Sprite }).rays ? ((this.sky as unknown as { rays: THREE.Sprite }).rays.material as THREE.SpriteMaterial).opacity : 0, radio: { on: this.radio.on, station: this.radio.station, ticks: this.radio.ticks, notes: this.radio.notes, ticker: $('radio-ticker').textContent }, signals: this.signals.signals.map((x) => ({ s: x.s, state: x.state, ran: x.ran, stoppedOk: x.stoppedOk })), redLights: this.redLights, busLength: this.busDef.dims.length, challenge: this.challenge?.id ?? null, lastChallenge: this.lastChallenge, fixedHour: this.fixedHour, story: this.story?.day ?? null, lastStory: this.lastStory, owner: this.ledger.owner, crowd: this.events.waitingMultiplier, audio: { ...this.audio.levels }, world: { railS: WORLD.railS, andolonS: WORLD.andolonS, bridgeStartS: WORLD.bridgeStartS, bridgeEndS: WORLD.bridgeEndS, tollS: WORLD.tollS, accidentS: WORLD.accidentS }, specialsDone: this.specialsDone, tips: this.ledger.tips, horns: this.horns, fogDensity: (this.scene.fog as THREE.FogExp2).density, lightning: this.lightningCount,
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

/** A challenge asked for by URL (?challenge=1 or a date) or left pending by the menu before a reload. */
function resolveBootChallenge(): Challenge | null {
  const q = params.get('challenge');
  let pending: string | null = null; try { pending = localStorage.getItem('cp-challenge-pending'); localStorage.removeItem('cp-challenge-pending'); } catch { /* ignore */ }
  const id = q === '1' ? dateId() : q && /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : pending;
  return id ? dailyChallenge(id) : null;
}
const BOOT_CHALLENGE = resolveBootChallenge();
/** A story day asked for by URL (?story=N) or left pending by the story panel before a route reload. */
function resolveBootStory(): StoryDay | null {
  const q = params.get('story');
  let pending: string | null = null; try { pending = localStorage.getItem('cp-story-pending'); localStorage.removeItem('cp-story-pending'); } catch { /* ignore */ }
  const n = q ? parseInt(q, 10) : pending ? parseInt(pending, 10) : NaN;
  return STORY.find((d) => d.day === n) ?? null;
}
const BOOT_STORY = BOOT_CHALLENGE ? null : resolveBootStory();
applyRoute(BOOT_CHALLENGE ? BOOT_CHALLENGE.routeId : BOOT_STORY ? BOOT_STORY.route : savedRouteId());
const game = new Game();
(window as unknown as { __game: Game }).__game = game;
game.init().catch((e) => { console.error(e); $('start-status').textContent = 'লোড করতে সমস্যা: ' + (e as Error).message; });
