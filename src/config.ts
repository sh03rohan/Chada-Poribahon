/**
 * চাঁদা পরিবহন — central tuning file.
 * Every gameplay/physics/visual number that someone might want to tweak lives here.
 * Units: SI unless stated (m, kg, s, rad). Speeds in HUD are km/h.
 */

export const PHYSICS = {
  /** Fixed physics step (Hz). Rendering interpolates between steps. */
  hz: 120,
  /** Cap on how many physics steps one frame may run (avoid spiral of death). */
  maxStepsPerFrame: 8,

  mass: 12000,            // kg
  wheelbase: 6.0,         // m
  /** Distance from centre of mass to front / rear axle (sum = wheelbase). */
  lf: 3.2,
  lr: 2.8,
  wheelRadius: 0.5,       // m
  trackWidth: 2.1,        // m (visual only)

  // --- Engine / drivetrain -------------------------------------------------
  idleRpm: 650,
  redlineRpm: 2700,
  /** Torque curve (rpm → Nm). Linearly interpolated. */
  torqueCurve: [
    [600, 700], [1000, 980], [1300, 1280], [1600, 1350],
    [1900, 1320], [2200, 1200], [2500, 1000], [2700, 620],
  ] as [number, number][],
  gearRatios: [6.1, 3.7, 2.35, 1.55, 1.12, 0.84],
  finalDrive: 4.6,
  drivetrainEfficiency: 0.86,
  /** Automatic gearbox */
  shiftUpRpm: 2350,
  shiftDownRpm: 1150,
  shiftDelay: 0.38,       // s of torque cut during a shift
  /** Engine braking torque at redline when throttle is 0 (Nm, scaled by rpm fraction). */
  engineBrakeTorque: 420,

  // --- Speed targets --------------------------------------------------------
  /** Reference targets, printed in the debug overlay next to measured values. */
  target0to60s: 10,
  targetTopSpeedKmh: 120,
  /** Soft governor: throttle fades out between topSpeed and governorKmh. */
  governorKmh: 125,

  // --- Resistance -----------------------------------------------------------
  dragCoefficient: 0.68,
  frontalArea: 7.6,       // m²
  airDensity: 1.2,
  rollingResistance: 0.011,
  offRoadResistance: 0.09, // extra rolling coefficient on grass/dirt
  offRoadBumpiness: 1.0,

  // --- Brakes ---------------------------------------------------------------
  brakeForce: 62000,      // N at full pedal
  handbrakeForce: 30000,  // N
  /** Brake input is smoothed so a tap doesn't slam. */
  brakeRampUp: 4.5,       // per second
  brakeRampDown: 8,
  throttleRampUp: 3.2,
  throttleRampDown: 6,

  // --- Steering -------------------------------------------------------------
  maxSteerLowSpeed: 0.62,  // rad (~35°) at standstill
  /** steer max = maxSteerLowSpeed / (1 + kmh / steerSpeedFalloffKmh) */
  steerSpeedFalloffKmh: 32,
  steerInputRate: 2.8,     // how fast steering input moves toward target (per s)
  steerReturnRate: 4.2,    // return-to-centre rate (per s)
  /** Yaw rate follows the kinematic target with this time constant (s). */
  yawResponseTau: 0.11,
  yawResponseTauHighSpeed: 0.22, // at 120 km/h

  // --- Grip -----------------------------------------------------------------
  gripDry: 0.78,          // μ — max lateral g on tarmac
  gripWet: 0.52,
  gripOffRoad: 0.45,
  gripHandbrake: 0.35,
  /** How quickly lateral slide velocity decays when grip is available (per s). */
  lateralDamping: 6.0,

  // --- Body motion (second-order spring-damper) -----------------------------
  rollPerLateralG: 0.018,  // rad per m/s² lateral (~7° at the grip limit)
  pitchPerLongG: 0.014,    // rad per m/s² longitudinal
  bodyOmega: 7.5,          // natural frequency rad/s
  bodyZeta: 0.42,          // damping ratio (<1 → slight overshoot, feels alive)
  maxRoll: 0.16,
  maxPitch: 0.09,
  heaveOmega: 9,
  heaveZeta: 0.6,
  roughnessAmplitude: 0.002,   // m, base road roughness bounce (barely perceptible)
  roughnessOffRoad: 0.045,
};

export const CAMERA = {
  near: 0.07,
  far: 1800,
  fovBase: 60,
  fovMax: 80,
  /** FOV reaches fovMax at this speed (km/h). */
  fovSpeedKmh: 120,
  chase: { back: 14, up: 5.2, lookUp: 1.8, stiffness: 5.5, lag: 0.12 },
  bonnet: { forward: 5.9, up: 2.25 },
  cockpit: { x: 0.85, y: 2.18, z: -3.95, lookDown: 5.5 }, // driver eye (right-hand drive), bus local; lookDown = metres below eye level at 30 m
  shakeHighSpeedKmh: 70,
  shakeAmplitude: 0.0,      // no camera shake on tarmac — the ride must feel smooth
  shakeRoughAmplitude: 0.03, // only off-road
  transitionTime: 0.6,
};

export const WORLD = {
  roadWidth: 7.0,        // two lanes
  laneWidth: 3.5,
  shoulderWidth: 1.6,
  frameSpacing: 2,       // m between road samples
  roadTextureTileLength: 10, // m
  driveOnLeft: true,
  /** s positions of key events in metres along the route. */
  rajbariStopS: 2000,
  stopZoneLength: 32,
  /** Every passenger stop on the route (s, name, people waiting, how many aboard get off, fare to Dhaka). */
  stops: [
    { s: 2000, name: 'রাজবাড়ী', waiting: 12, getOff: 7, fare: 300 },
    { s: 3440, name: 'ফরিদপুর', waiting: 8, getOff: 6, fare: 220 },
    { s: 4480, name: 'ভাঙ্গা', waiting: 6, getOff: 4, fare: 150 },
    { s: 5850, name: 'গাবতলী (ঢাকা)', waiting: 0, getOff: 10, fare: 0 },
  ],
  /** Phase 2 incidents (metres along the route) */
  chadaSpots: [1150, 4300],
  checkpointS: 3000,
  speedCameraS: 4900,
  speedCameraLimitKmh: 80,
  pumpS: 2700,
  forkS: 2460,          // wrong-turn fork (Daulatdia ghat branch)
  andolonS: 3850,
  bridgeStartS: 4650,
  bridgeEndS: 5350,
  finishS: 6050,
  /** City roundabouts (গোল চত্বর): the road splits around a central island here. */
  roundabouts: [{ s: 2130, name: 'রাজবাড়ী' }, { s: 3560, name: 'ফরিদপুর' }, { s: 5720, name: 'ঢাকা' }],
  roundaboutHalfLength: 48,
  roundaboutBulge: 9,
  islandRadius: 6.6,
  /** Prop density multipliers per tier. */
  propDensity: { low: 0.45, medium: 0.75, high: 1.0 },
  treesPerKm: 170,
  polesSpacing: 42,
  fogDensity: 0.00085,
  /** Kerbed footpaths + striped kerbs along these s ranges (towns); the Dhaka approach is a divided highway. */
  kerbRanges: [[1750, 2550], [3250, 3950], [5450, 6150]] as [number, number][],
  highwayStartS: 5400,   // divided highway with a planted median from here to the finish
  medianWidth: 2.4,
};

export const GAMEPLAY = {
  initialPassengers: 24,
  seats: 36,
  fareKushtiaDhaka: 450,  // ৳
  fareRajbariDhaka: 300,
  rajbariGetOff: 7,
  rajbariGetOn: 12,
  /** Phase 2 economy */
  chadaAmount: 200,
  chadaRefuseBlockSec: 8,
  chadaRefusePenalty: 5,
  checkpointFine: 500,
  checkpointSpeedLimitKmh: 30,
  checkpointDelaySec: 12,
  cameraFine: 300,
  begAmount: 10,
  fuelTankLitres: 120,
  fuelPricePerLitre: 65,
  /** litres the pump attendant fills per visit (enough to reach Dhaka) */
  fuelPumpLitres: 40,
  /** litres per second at full throttle + redline; scales with throttle × rpm */
  /** litres per second at full throttle near redline (arcade-scaled so the pump matters on a 6 km run) */
  fuelBurnPerSec: 0.1,
  /** tank fraction at the start of a run, random in this range */
  fuelStartFraction: [0.3, 0.38] as [number, number],
  fuelIdlePerSec: 0.004,
  emptyTankRescueCost: 800,
  emptyTankRescueLitres: 20,
  emptyTankRescueSec: 20,
  morningRushStart: 7, morningRushEnd: 10,
  stopDwellTime: 5,       // s doors open
  /** Mood */
  moodStart: 75,
  moodSmoothGainPerSec: 0.45,
  moodSmoothMinKmh: 20,
  hardBrakeDecel: 3.6,     // m/s²
  hardBrakePenalty: 4,
  swerveLatAccel: 3.2,     // m/s²
  swervePenalty: 3,
  overspeedKmh: 92,
  overspeedPenaltyPerSec: 0.9,
  offRoadPenaltyPerSec: 1.6,
  missedStopPenalty: 18,
  blockadeHitPenalty: 10,
  blockadeWaitPenaltyPerSec: 0.35,
  wrongBranchPenaltyPerSec: 0.6,
  wrongBranchEnterPenalty: 5,
  idleTooLongSec: 20,      // standing still with passengers
  idlePenaltyPerSec: 0.3,
  shoutCooldown: 4.5,      // s between speech bubbles
  /** Andolon timeline */
  policeArriveAfter: 24,   // s after first stopping at blockade
  crowdDisperseTime: 7,    // s after police arrive
  /** Results */
  starThresholds: [20, 40, 58, 75, 88], // mood needed for 1..5 stars
};

export const AUDIO = {
  masterGain: 0.8,
  engineGain: 0.55,
  hornGain: 0.5,
  roadGain: 0.35,
  windGain: 0.45,
  rainGain: 0.25,
};

export type QualityTier = 'low' | 'medium' | 'high';

export const QUALITY: Record<QualityTier, {
  pixelRatio: number; shadows: boolean; bloom: boolean; rainCount: number;
  anisotropy: number; envMapSize: number; shadowMapSize: number;
}> = {
  low: { pixelRatio: 1, shadows: false, bloom: false, rainCount: 1200, anisotropy: 2, envMapSize: 128, shadowMapSize: 1024 },
  medium: { pixelRatio: 1.5, shadows: true, bloom: false, rainCount: 2600, anisotropy: 4, envMapSize: 256, shadowMapSize: 1024 },
  // bloom is off: the procedural sky is HDR-bright, so any bloom threshold spreads sky light over the frame
  high: { pixelRatio: 2, shadows: true, bloom: false, rainCount: 5000, anisotropy: 8, envMapSize: 256, shadowMapSize: 2048 },
};

export const BUS_DIMENSIONS = {
  length: 11.2,
  width: 2.5,
  height: 3.3,       // top of roof above ground
  floorHeight: 0.95, // cabin floor above ground
  skirtHeight: 0.42, // lowest body edge above ground
};
