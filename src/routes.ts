import { WORLD } from './config.ts';

/**
 * Route registry. Everything that differs between routes lives here: geometry, event distances,
 * stops, town clusters, signs, junction directions, map labels and the Bangla names used in
 * messages. `applyRoute()` copies the chosen route's numbers into WORLD before the world is built.
 */
export type RouteId = 'kushtia-dhaka' | 'dhaka-sylhet' | 'dhaka-chattogram';

export interface Scenery { teaHills: [number, number][]; haor: [number, number][]; hills?: [number, number][]; sea?: { range: [number, number]; side: -1 | 1 }[] }

type WorldNumbers = Pick<typeof WORLD, 'stops' | 'chadaSpots' | 'checkpointS' | 'speedCameraS' | 'pumpS' | 'forkS' | 'andolonS' | 'bridgeStartS' | 'bridgeEndS' | 'finishS' | 'roundabouts' | 'kerbRanges' | 'tollS' | 'railS' | 'accidentS' | 'highwayStartS' | 'cattleS' | 'signalsS'>;

export interface RouteDef {
  id: RouteId;
  label: string;              // "কুষ্টিয়া → ঢাকা"
  from: string; to: string;
  /** locative form of `to` for sentences ("ঢাকায়", "সিলেটে") */
  toLoc: string;
  available: boolean;
  route: [number, number][];  // [length m, turn deg]
  branch: [number, number][];
  world: WorldNumbers;
  ferryLandS: number;
  names: {
    startGate: string[]; finishGate: string[];
    bridge: string; river: string;
    tollSign: string[];
    correctWay: string;        // "ঢাকা ➜ পদ্মা সেতু"
    wrongWayBoard: string[];   // gantry right board
    ghat: string;              // "দৌলতদিয়া ফেরি ঘাট"
    ghatSign: string[];        // roadside sign on the branch
    forkName: string;          // map label at the fork
    branchLabel: string;       // map label at the branch end
    lostStops: string;         // "ফরিদপুর-ভাঙ্গার যাত্রী"
  };
  directions: Record<string, [string, string, string, string]>;
  signs: [number, string[], string][];
  clusters: { s: number; n: number; spread: number }[];
  hawkerSpots: number[];
  waypoints: [number, string][];
  scenery: Scenery;
}

const KUSHTIA: RouteDef = {
  id: 'kushtia-dhaka', label: 'কুষ্টিয়া → ঢাকা', from: 'কুষ্টিয়া', to: 'ঢাকা', toLoc: 'ঢাকায়', available: true,
  route: [
    [350, 0], [400, 35], [300, 0], [450, -50], [250, 0],
    [450, 0],            // Rajbari straight (stop at s=2000)
    [350, -40], [300, 25], [400, 0], [500, -60],
    [350, 0],            // Faridpur straight (andolon at s=3850)
    [300, 45], [250, 0],
    [700, 0],            // Padma bridge section
    [300, -30], [500, 0], // Dhaka approach (finish at 6050)
  ],
  branch: [[60, 0], [140, 38], [230, 0], [60, -12], [40, 0]],
  world: {
    stops: [
      { s: 2000, name: 'রাজবাড়ী', waiting: 12, getOff: 7, fare: 300 },
      { s: 3440, name: 'ফরিদপুর', waiting: 8, getOff: 6, fare: 220 },
      { s: 4480, name: 'ভাঙ্গা', waiting: 6, getOff: 4, fare: 150 },
      { s: 5850, name: 'গাবতলী (ঢাকা)', waiting: 0, getOff: 10, fare: 0 },
    ],
    chadaSpots: [1150, 4300], checkpointS: 3000, speedCameraS: 4900, pumpS: 2700, forkS: 2460, andolonS: 3850,
    bridgeStartS: 4650, bridgeEndS: 5350, finishS: 6050,
    roundabouts: [{ s: 2130, name: 'রাজবাড়ী' }, { s: 3560, name: 'ফরিদপুর' }, { s: 5720, name: 'ঢাকা' }],
    kerbRanges: [[1750, 2550], [3250, 3950], [5450, 6150]], tollS: 4600, railS: 1650, accidentS: 3250, highwayStartS: 5400, cattleS: [1450, 4150], signalsS: [2300, 3750, 5600],
  },
  ferryLandS: 5420,
  names: {
    startGate: ['কুষ্টিয়া বাস টার্মিনাল', 'শুভ যাত্রা'], finishGate: ['ঢাকা', 'স্বাগতম'], bridge: 'পদ্মা সেতু', river: 'পদ্মা',
    tollSign: ['পদ্মা সেতু টোল প্লাজা', 'বাস ৳১,৫০০ · থামুন'], correctWay: 'ঢাকা ➜ পদ্মা সেতু', wrongWayBoard: ['দৌলতদিয়া ঘাট ➜', 'ফেরি'],
    ghat: 'দৌলতদিয়া ফেরি ঘাট', ghatSign: ['ফেরি ঘাট ২ কিমি', 'ভারী যানবাহন লাইন'], forkName: 'দৌলতদিয়া মোড়', branchLabel: 'দৌলতদিয়া ঘাট (ভুল রাস্তা)', lostStops: 'ফরিদপুর-ভাঙ্গার যাত্রী',
  },
  directions: {
    'রাজবাড়ী': ['ঢাকা', 'কুষ্টিয়া', 'পাংশা', 'গোয়ালন্দ ঘাট'],
    'ফরিদপুর': ['ঢাকা', 'রাজবাড়ী', 'ভাঙ্গা', 'মধুখালী'],
    'ঢাকা': ['ঢাকা শহর', 'পদ্মা সেতু', 'গাবতলী', 'সায়েদাবাদ'],
  },
  signs: [
    [350, ['রাজবাড়ী ১.৬ কিমি', 'ঢাকা ৫.৭ কিমি'], '#1f6fb5'], [1700, ['রাজবাড়ী বাস স্ট্যান্ড', 'সামনে থামুন'], '#1f9d55'],
    [2600, ['ফরিদপুর', 'সাবধানে চালান'], '#1f6fb5'], [3400, ['গতিসীমা', '৮০'], '#d8262c'],
    [4530, ['পদ্মা সেতু', 'গতি কমান'], '#1f6fb5'], [5350, ['ঢাকা ০.৭ কিমি', 'স্বাগতম'], '#1f9d55'],
  ],
  clusters: [{ s: 2000, n: 10, spread: 160 }, { s: 1150, n: 4, spread: 90 }, { s: 3550, n: 5, spread: 120 }, { s: 4450, n: 4, spread: 80 }, { s: 3560, n: 9, spread: 150 }, { s: 5700, n: 16, spread: 260 }],
  hawkerSpots: [1960, 2060, 1150, 5750, 5630, 3550],
  waypoints: [[40, 'কুষ্টিয়া'], [2000, 'রাজবাড়ী'], [2460, 'দৌলতদিয়া মোড়'], [3440, 'ফরিদপুর'], [4480, 'ভাঙ্গা'], [5000, 'পদ্মা সেতু'], [6050, 'ঢাকা']],
  scenery: { teaHills: [], haor: [] },
};

const SYLHET: RouteDef = {
  id: 'dhaka-sylhet', label: 'ঢাকা → সিলেট', from: 'ঢাকা', to: 'সিলেট', toLoc: 'সিলেটে', available: true,
  route: [
    [400, 0], [350, -30], [300, 0], [450, 40], [300, 0],
    [450, 0],            // Narsingdi straight (stop 2000, junction 2130)
    [300, -35], [250, 0],
    [700, 0],            // Meghna bridge (2880–3460), toll 2830, camera 3200
    [300, 30], [350, 0], // Sayestaganj (stop 3950, junction 4080)
    [400, 0],            // accident 4380
    [300, -45], [400, 0], // andolon 5000
    [350, 20], [300, 0], // tea gardens (5250–5950), Sreemangal stop 5700
    [600, 0],            // Sylhet approach, divided highway from 6000, finish 6500
  ],
  branch: [[60, 0], [140, 38], [230, 0], [60, -12], [40, 0]],
  world: {
    stops: [
      { s: 2000, name: 'নরসিংদী', waiting: 12, getOff: 7, fare: 350 },
      { s: 3950, name: 'শায়েস্তাগঞ্জ', waiting: 8, getOff: 6, fare: 250 },
      { s: 5700, name: 'শ্রীমঙ্গল', waiting: 6, getOff: 4, fare: 150 },
      { s: 6300, name: 'কদমতলী (সিলেট)', waiting: 0, getOff: 10, fare: 0 },
    ],
    chadaSpots: [600, 4600], checkpointS: 2700, speedCameraS: 3200, pumpS: 1250, forkS: 2460, andolonS: 5000,
    bridgeStartS: 2880, bridgeEndS: 3460, finishS: 6450,
    roundabouts: [{ s: 2130, name: 'নরসিংদী' }, { s: 4080, name: 'শায়েস্তাগঞ্জ' }, { s: 6250, name: 'সিলেট' }],
    kerbRanges: [[1800, 2300], [3800, 4200], [6000, 6600]], tollS: 2830, railS: 900, accidentS: 4380, highwayStartS: 6000, cattleS: [1700, 5300], signalsS: [2250, 4180, 6100],
  },
  ferryLandS: 3600,
  names: {
    startGate: ['ঢাকা সায়েদাবাদ টার্মিনাল', 'শুভ যাত্রা'], finishGate: ['সিলেট', 'স্বাগতম'], bridge: 'মেঘনা সেতু', river: 'মেঘনা',
    tollSign: ['ভৈরব সেতু টোল প্লাজা', 'বাস ৳১,৫০০ · থামুন'], correctWay: 'সিলেট ➜ ভৈরব সেতু', wrongWayBoard: ['আশুগঞ্জ ঘাট ➜', 'ফেরি'],
    ghat: 'আশুগঞ্জ ফেরি ঘাট', ghatSign: ['ফেরি ঘাট ২ কিমি', 'ভারী যানবাহন লাইন'], forkName: 'ভৈরব মোড়', branchLabel: 'আশুগঞ্জ ঘাট (ভুল রাস্তা)', lostStops: 'শায়েস্তাগঞ্জ-শ্রীমঙ্গলের যাত্রী',
  },
  directions: {
    'নরসিংদী': ['সিলেট', 'ঢাকা', 'পলাশ', 'রায়পুরা'],
    'শায়েস্তাগঞ্জ': ['সিলেট', 'ঢাকা', 'হবিগঞ্জ', 'মাধবপুর'],
    'সিলেট': ['সিলেট শহর', 'ঢাকা', 'কদমতলী', 'আম্বরখানা'],
  },
  signs: [
    [350, ['নরসিংদী ১.৬ কিমি', 'সিলেট ৬.১ কিমি'], '#1f6fb5'], [1700, ['নরসিংদী বাস স্ট্যান্ড', 'সামনে থামুন'], '#1f9d55'],
    [2600, ['ভৈরব সেতু', 'সাবধানে চালান'], '#1f6fb5'], [3700, ['গতিসীমা', '৮০'], '#d8262c'],
    [2760, ['মেঘনা সেতু', 'গতি কমান'], '#1f6fb5'], [5300, ['চা বাগান', 'সাবধান — বাঁক'], '#1f9d55'], [5800, ['সিলেট ০.৭ কিমি', 'স্বাগতম'], '#1f9d55'],
  ],
  clusters: [{ s: 2000, n: 10, spread: 160 }, { s: 600, n: 4, spread: 90 }, { s: 4700, n: 5, spread: 120 }, { s: 3950, n: 9, spread: 150 }, { s: 5700, n: 5, spread: 110 }, { s: 6150, n: 16, spread: 260 }],
  hawkerSpots: [1960, 2060, 600, 6200, 6080, 4700],
  waypoints: [[40, 'ঢাকা'], [2000, 'নরসিংদী'], [2460, 'ভৈরব মোড়'], [3170, 'মেঘনা সেতু'], [3950, 'শায়েস্তাগঞ্জ'], [5700, 'শ্রীমঙ্গল'], [6450, 'সিলেট']],
  scenery: { teaHills: [[5250, 5950]], haor: [[3520, 3880]] },
};

const CHATTOGRAM: RouteDef = {
  id: 'dhaka-chattogram', label: 'ঢাকা → চট্টগ্রাম', from: 'ঢাকা', to: 'চট্টগ্রাম', toLoc: 'চট্টগ্রামে', available: true,
  route: [
    [400, 0], [350, 25], [300, 0], [450, -35], [300, 0],
    [450, 0],            // Kanchpur straight (stop 2000, junction 2130)
    [300, 30], [250, 0],
    [700, 0],            // Meghna-Gumti bridge (2880–3460), toll 2830, camera 3200
    [300, -25], [350, 0], // Comilla (stop 3950, junction 4080)
    [400, 0],            // accident 4380
    [300, 40], [400, 0], // andolon 5000 (Feni)
    [350, -30], [300, 0], // Sitakunda hills (5250–5950), stop 5700
    [600, 0],            // sea on the right, Chattogram from 6000, finish 6450
  ],
  branch: [[60, 0], [140, -38], [230, 0], [60, 12], [40, 0]],
  world: {
    stops: [
      { s: 2000, name: 'কাঁচপুর', waiting: 12, getOff: 7, fare: 350 },
      { s: 3950, name: 'কুমিল্লা', waiting: 8, getOff: 6, fare: 250 },
      { s: 5700, name: 'সীতাকুণ্ড', waiting: 6, getOff: 4, fare: 150 },
      { s: 6300, name: 'অলংকার (চট্টগ্রাম)', waiting: 0, getOff: 10, fare: 0 },
    ],
    chadaSpots: [600, 4600], checkpointS: 2700, speedCameraS: 3200, pumpS: 1250, forkS: 2460, andolonS: 5000,
    bridgeStartS: 2880, bridgeEndS: 3460, finishS: 6450,
    roundabouts: [{ s: 2130, name: 'কাঁচপুর' }, { s: 4080, name: 'কুমিল্লা' }, { s: 6250, name: 'চট্টগ্রাম' }],
    kerbRanges: [[1800, 2300], [3800, 4200], [6000, 6600]], tollS: 2830, railS: 900, accidentS: 4380, highwayStartS: 6000, cattleS: [1800, 5450], signalsS: [2250, 4180, 6100],
  },
  ferryLandS: 3600,
  names: {
    startGate: ['ঢাকা সায়েদাবাদ টার্মিনাল', 'শুভ যাত্রা'], finishGate: ['চট্টগ্রাম', 'স্বাগতম'], bridge: 'মেঘনা-গোমতী সেতু', river: 'মেঘনা',
    tollSign: ['মেঘনা-গোমতী টোল প্লাজা', 'বাস ৳১,৫০০ · থামুন'], correctWay: 'চট্টগ্রাম ➜ মেঘনা সেতু', wrongWayBoard: ['চাঁদপুর ঘাট ➜', 'ফেরি'],
    ghat: 'চাঁদপুর ফেরি ঘাট', ghatSign: ['ফেরি ঘাট ২ কিমি', 'ভারী যানবাহন লাইন'], forkName: 'দাউদকান্দি মোড়', branchLabel: 'চাঁদপুর ঘাট (ভুল রাস্তা)', lostStops: 'কুমিল্লা-সীতাকুণ্ডের যাত্রী',
  },
  directions: {
    'কাঁচপুর': ['চট্টগ্রাম', 'ঢাকা', 'নারায়ণগঞ্জ', 'সিলেট'],
    'কুমিল্লা': ['চট্টগ্রাম', 'ঢাকা', 'কুমিল্লা শহর', 'নোয়াখালী'],
    'চট্টগ্রাম': ['চট্টগ্রাম শহর', 'ঢাকা', 'বন্দর', 'কক্সবাজার'],
  },
  signs: [
    [350, ['কাঁচপুর ১.৬ কিমি', 'চট্টগ্রাম ৬.১ কিমি'], '#1f6fb5'], [1700, ['কাঁচপুর বাস স্ট্যান্ড', 'সামনে থামুন'], '#1f9d55'],
    [2600, ['মেঘনা-গোমতী সেতু', 'সাবধানে চালান'], '#1f6fb5'], [3700, ['গতিসীমা', '৮০'], '#d8262c'],
    [2760, ['মেঘনা সেতু', 'গতি কমান'], '#1f6fb5'], [5300, ['সীতাকুণ্ড পাহাড়', 'সাবধান — বাঁক'], '#1f9d55'], [5800, ['চট্টগ্রাম ০.৭ কিমি', 'স্বাগতম'], '#1f9d55'],
  ],
  clusters: [{ s: 2000, n: 10, spread: 160 }, { s: 600, n: 4, spread: 90 }, { s: 4700, n: 5, spread: 120 }, { s: 3950, n: 9, spread: 150 }, { s: 5700, n: 5, spread: 110 }, { s: 6150, n: 16, spread: 260 }],
  hawkerSpots: [1960, 2060, 600, 6200, 6080, 4700],
  waypoints: [[40, 'ঢাকা'], [2000, 'কাঁচপুর'], [2460, 'দাউদকান্দি মোড়'], [3170, 'মেঘনা সেতু'], [3950, 'কুমিল্লা'], [5700, 'সীতাকুণ্ড'], [6450, 'চট্টগ্রাম']],
  scenery: { teaHills: [], haor: [], hills: [[5200, 6000]], sea: [{ range: [5950, 6480], side: 1 }] },
};

export const ROUTES: RouteDef[] = [KUSHTIA, SYLHET, CHATTOGRAM];

/** The active route. Mutated in place by applyRoute so every module sees the same object. */
export const ROUTE: RouteDef = structuredClone(KUSHTIA);

const KEY = 'cp-route';
export function savedRouteId(): RouteId {
  const q = new URLSearchParams(location.search).get('route') as RouteId | null;
  let saved: string | null = null; try { saved = localStorage.getItem(KEY); } catch { /* ignore */ }
  const id = (q ?? saved ?? 'kushtia-dhaka') as RouteId;
  return ROUTES.some((r) => r.id === id && r.available) ? id : 'kushtia-dhaka';
}
export function selectRoute(id: RouteId) { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } }

/** Copy the route's numbers into WORLD and the names into ROUTE. Call before building the world. */
export function applyRoute(id: RouteId): RouteDef {
  const def = ROUTES.find((r) => r.id === id) ?? KUSHTIA;
  const copy = structuredClone(def);
  Object.assign(ROUTE, copy);
  Object.assign(WORLD, structuredClone(def.world));
  WORLD.rajbariStopS = WORLD.stops[0].s;
  return ROUTE;
}
