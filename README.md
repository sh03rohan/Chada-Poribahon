# চাঁদা পরিবহন (Chada Poribohon) — Phase 8

A browser-based Bangladeshi bus-driving game. Vite + TypeScript + three.js, no framework.
Routes: কুষ্টিয়া → রাজবাড়ী → ফরিদপুর → ভাঙ্গা → পদ্মা সেতু → ঢাকা (~6 km), ঢাকা → নরসিংদী → মেঘনা সেতু → শায়েস্তাগঞ্জ → চা বাগান → শ্রীমঙ্গল → সিলেট (~6.5 km) and ঢাকা → কাঁচপুর → মেঘনা-গোমতী সেতু → কুমিল্লা → সীতাকুণ্ড পাহাড় → সমুদ্র → চট্টগ্রাম (~6.5 km); left-hand traffic.

```
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build → dist/
npm run tune       # offline physics harness: prints measured 0–60, top speed, braking
npm test           # Playwright: screenshots + cockpit-glass check + physics + route events
```

Deploy: push to Vercel (framework preset "Vite", `vercel.json` included). All assets are static.

## Controls

| Action      | Keyboard            | Touch                    | Gamepad        |
|-------------|---------------------|--------------------------|----------------|
| Gas / brake | W / S or ↑ / ↓      | গ্যাস / ব্রেক buttons    | RT / LT or A   |
| Steer       | A / D or ← / →      | ◀ / ▶                    | Left stick     |
| Handbrake   | Space               | —                        | B              |
| Horn        | H                   | 📯                       | X              |
| Camera      | C                   | 📷                       | —              |
| Map         | M                   | 🗺️                      | —              |
| Pause       | Esc / P             | ⏸                        | —              |
| Rain toggle | R                   | 🌧️                      | —              |
| Debug       | F3 or `             | —                        | —              |

Flow: **landing page** (3D bus at sunrise; "শুরু করুন" is the audio-unlock gesture) → **intro cinematic** (~30 s,
skippable any time with the স্কিপ button, Esc, Space or a tap; remembered in `localStorage`, replay from the
menu) → **pre-trip map** (route selector; other routes are greyed "শিগগিরই") → driving → results.

### Settings (⚙ from the main menu or the pause menu, persisted in `localStorage` under `cp-settings`)

| Setting | Values | Notes |
|---|---|---|
| স্টিয়ারিং | স্টিয়ারিং হুইল / বাম-ডান বাটন | Only the selected scheme exists in the DOM. Wheel: drag to rotate, ±135° = full lock, self-centres on release, haptic tick (`navigator.vibrate`) at centre. Buttons: ramped input via the physics smoothing. Keyboard always works too. |
| কন্ট্রোলের দিক | বামে / ডানে | Steering on the chosen side, gas/brake/horn on the other. |
| সংবেদনশীলতা | 50–150 % | Multiplies steering input. |
| ডিফল্ট ক্যামেরা | chase / bonnet / cockpit | |
| গ্রাফিক্স | auto / low / medium / high | Reload applies. |
| ভলিউম | 0–100 % | |
| মিনিম্যাপ | heading-up / north-up | |

### Map

HUD minimap (top-left, round): route line, player arrow, next-objective ring, 🚏 Rajbari, ⚠️ andolon (only while
active), 🏁 Dhaka, progress %. **M** opens the full map (pauses): named waypoints, correct route highlighted,
greyed wrong branch, position, distance remaining, ETA. About 40 % in there is a fork with gantry signboards
("ঢাকা ➜ পদ্মা সেতু" straight, "দৌলতদিয়া ঘাট ➜" right). The right branch is a ferry-queue dead end with a
turnaround pad: "রাস্তা ভুল!" warning, mood drain, reroute arrow on both maps until you are back on the main road.

### Compact phone layout

Any viewport under 560 px tall (every phone in landscape) switches to a compact HUD (`@media (max-height: 560px)`
in `src/style.css`): one thin strip of value chips on top, mood bar + minimap tucked top-left, icon buttons
top-right, steering bottom-left, pedals bottom-right, messages/banners small and centred just under the strip,
passenger bubbles low and narrow, panels (landing, pre-trip, map, pause, results) scaled to fit without
scrolling. `scripts/probe-mobile.mjs` screenshots every screen at Pixel 7 and iPhone sizes.

### Cities, roundabouts, weather, mobile

* **চত্বর / 4-way junctions** at Rajbari (2.13 km), Faridpur (3.56 km) and Dhaka (5.72 km): the main road widens
  (`Road.bulge`) and splits around a kerbed island with a monument, flower beds and lamps; two side roads leave
  left and right, and a 4-face direction sign on the island tells arriving traffic where each road goes
  (`DIRECTIONS` in `src/world/roundabouts.ts`). Traffic, pedestrians and the autopilot follow the widened lanes;
  the island is solid; the side roads count as road surface (`Roundabouts.onSideRoad`) but lead off-route.
* **Solid world** (`src/world/collision.ts`): every placed prop registers a collider circle (trees, poles, lamp
  posts, signs, shops, buildings as rows of circles, shed, gate and gantry posts, bridge railings, ferry-queue
  trucks, islands); traffic vehicles and the police van are added per step. The bus is 5 circles; penetrations
  against static props are pushed out and the velocity into the obstacle removed, so it stops against things
  or slides along them. **Vehicles are not walls**: a hit is an inelastic momentum exchange using the closing
  speed and the masses (`SPEC[type].mass` vs `PHYSICS.mass`), so the bus keeps M/(M+m) of its speed, an
  off-centre hit twists it, and the other vehicle is shoved along the contact normal, then brakes, pulls fully
  onto the shoulder and rejoins a few seconds later (`Traffic.applyContacts`, `Vehicle.hitT`).
  Impacts > 2 m/s cost mood (3–15), show a message and play a thump.
* **Ride**: no camera shake on tarmac and only a 2 mm road bounce (`CAMERA.shake*`, `PHYSICS.roughness*`) — the
  bus is meant to feel heavy and smooth; off-road keeps a mild shake.
* **Sky**: driven by the device clock (re-read every minute while driving, so dusk falls mid-trip); visible sun disc + glow, moon and stars at night (moonlit look: ambient stays at ~35 % of daytime so the surroundings remain readable, exposure 0.5, lighter fog), a cloud
  dome that thickens and darkens with rain, fog/light/exposure all re-derived on every time or weather change.
* **Mobile**: the first menu tap requests fullscreen + `screen.orientation.lock('landscape')` (Android); where
  locking is unsupported (iOS) a portrait overlay asks the player to rotate. `manifest.webmanifest` declares
  `orientation: landscape` for installed/PWA use.

### Traffic & people

Ambient traffic (cars, bikes with riders, buses, trucks, CNG autos) runs in both lanes. Following uses a
stopping-distance rule (fastest speed from which the vehicle can still slow to its leader within the gap at
4.5 m/s²), so vehicles queue behind the bus and the blockade instead of driving through it. If the bus sits
in the oncoming lane, oncoming vehicles do not scatter: when there is room between the bus and their kerb
(`width + 0.5 m`) they squeeze past along the edge at walking pace, otherwise they brake and wait in line,
each behind the one ahead, until the lane clears; nobody pulls out to overtake toward the bus.
Rear-ending a vehicle shoves it (momentum exchange, see *Solid world*) and costs mood.
Vehicle meshes are side-profile silhouettes extruded across the width (`profile()` in `src/world/traffic.ts`:
bonnet, raked windscreen, roof, boot, glass band, pillars) with wheels, arches, lights and mirrors. Pedestrians walk the footpaths, hawkers stand at shop
clusters, a helper hangs from the door shouting "ঢাকা ঢাকা!", passengers board at Rajbari.

Holding brake while stopped creeps backwards (arcade reverse). Cameras: chase → bonnet → cockpit
(right-hand-drive eye position; follows body roll/pitch).

URL parameters (used by the tests, handy for debugging): `?autostart=1`, `?view=cockpit|bonnet|chase`,
`?hour=22` (override device clock), `?rain=1`, `?quality=low|medium|high`, `?debug=1`.

## Tuning guide — `src/config.ts`

Every tunable number lives in one file. The pure physics (`src/vehicle/physics.ts`) has no three.js
dependency, so `npm run tune` runs it in Node at 120 Hz and prints the measured values:

```
0–60 km/h : 10.06 s   (target 10 s)
Top speed : 121.4 km/h (target 120, governor 125)
60→0 brake: 27.2 m
```

* **Acceleration** — `PHYSICS.torqueCurve` (rpm → Nm), `gearRatios`, `finalDrive`, `drivetrainEfficiency`, `mass`.
  Scale the torque curve up/down for 0–60; the measured value also appears live in the debug overlay.
* **Top speed** — balance of torque vs `dragCoefficient × frontalArea` and `rollingResistance`.
  `targetTopSpeedKmh` / `governorKmh` set a soft governor that fades throttle between the two.
* **Gearbox feel** — `shiftUpRpm`, `shiftDownRpm`, `shiftDelay` (torque cut while shifting).
* **Steering** — `maxSteerLowSpeed` (rad at standstill), `steerSpeedFalloffKmh` (how fast max angle
  shrinks with speed), `steerInputRate` / `steerReturnRate` (input smoothing), `yawResponseTau*`
  (how lazily the 12-tonne body follows the wheels).
* **Grip** — `gripDry`, `gripWet`, `gripOffRoad`, `gripHandbrake` (max lateral g). Exceeding grip
  scales yaw (understeer) and builds a lateral slide.
* **Body motion** — `rollPerLateralG`, `pitchPerLongG`, `bodyOmega`, `bodyZeta` (<1 gives the
  slight overshoot that makes the bus feel heavy and alive), `heave*` and `roughness*` for bounce.
* **Camera** — `CAMERA.fovBase → fovMax` over `fovSpeedKmh`, chase spring `stiffness`, shake amplitudes,
  cockpit eye position (`CAMERA.cockpit`, bus-local, RHD → positive x).
* **Gameplay** — `GAMEPLAY.*`: mood penalties/gains, fares, passenger counts, blockade timings, star thresholds.
* **World** — `WORLD.*`: event positions along the route (metres), lane widths, prop densities, fog.

Physics runs at a fixed `PHYSICS.hz` (120) with render interpolation, so the feel is identical at any
frame rate.

## Quality tiers

Auto-detected in `src/quality.ts` from cores / memory / mobile / renderer string; override with the ⚙️
button (persisted in `localStorage`) or `?quality=`.

| Tier   | Pixel ratio | Shadows             | Bloom | Rain particles | Props |
|--------|-------------|---------------------|-------|----------------|-------|
| low    | 1.0         | blob shadow only    | no    | 1200           | 45 %  |
| medium | ≤1.5        | PCF soft shadow map (1k) | no | 2600         | 75 %  |
| high   | ≤2.0        | PCF soft shadow map | off*  | 5000           | 100 % |

\* The bloom pass (`QUALITY.high.bloom`) exists but is off: the procedural sky's radiance is well above 1, so every
threshold bloomed the sky over the whole frame and the EffectComposer path blended HDR before tone mapping, washing
out the cockpit. The high tier renders directly.

All tiers: sRGB output, ACES tone mapping, PMREM environment baked from the procedural sky
(re-baked when time of day or weather changes).

## People (`src/world/people.ts`)

One stylised humanoid factory: a 17-bone skeleton (hips, spine, chest, neck, head, arms, hands, legs, feet),
rigidly skinned low-poly parts (~600–900 tris), one shared vertex-colour material, one `SkinnedMesh` per
person (single draw call). Proportions ≈ 7 heads. Geometry is cached per **variant**; all persons sharing a
variant share the geometry.

```ts
import { makeVariant, Person } from './world/people';
const v = makeVariant({ id: 'c15', outfit: 'panjabi', hair: 'tupi', top: '#fff', bottom: '#fff', accent: '#eee', height: 1.7, build: 1.05, prop: 'phone' });
const p = new Person(v); p.setAction('talk'); scene.add(p.root); peopleManager.add(p);
```

* `outfit`: shirt-pants · panjabi · lungi-shirt · saree · school · police · driver · helper
* `hair`: short · cap · tupi · gamchha · hijab · orna · bun · policecap
* `prop`: phone · placard (blank cardboard) · megaphone · bag · basket · notes · slip
* `height` (±8 % looks natural), `build` 0.85–1.2, `skin`, colours, `armScale` (driver 1.3 to reach the wheel)
* Actions: idle, walk (`walkTo(target, then)`), sit, talk, point, wave, film, shield, megaphone, signal, sleep,
  phonecall, fan, hang, drive (arms by 2-bone IK via `ikL/ikR`), seated (+`seatedSub`), ride, count, handover, hawk, queue.
  Phases are randomised per person. Add a new variant by pushing into `VARIANTS`; add a pose as a new `case` in `Person.update`.
* `PeopleManager` hides people beyond 80 m, animates the nearest 40 every frame, farther ones at 1/2 and 1/4 rate.

The driver is a `Person` seated in the RHD seat whose hands are glued to the 9 and 3 o'clock rim points of the
3D steering wheel by analytic two-bone IK (`Person.solveArm`); the left hand leaves the wheel for the horn/shifter.
Crowd (20–28) and police (4–6, generic fictional uniform, no insignia text) at the andolon use the same factory;
dispersal is by walking, police use megaphone / hand-signal poses.

## Intro cinematic (`src/game/cinematic.ts`)

A keyframe timeline: `Shot[]` with `at`, `dur`, `caption`, optional `title`, `enter()` (stage actors / teleport the
bus / set the hour), `update(k, t)` (camera via `host.setCamera`, bus-local or world keyframes eased with smoothstep)
and `exit()`. Captions are Bangla; all actors come from the people factory and the game world (no video).
`prefers-reduced-motion` shortens shots and turns camera moves into cuts. The 3D intro runs on every quality tier;
only a lost WebGL context falls back to the same captions over illustrated canvas slides. Storyboard: 0–3 title/sunrise · 3–8 bus stand · 8–13 on the
road/interior/hands · 13–18 chada hand-over · 18–24 andolon + time-lapse · 24–28 police + fine slip · 28–30 your turn.

## Bus model

The default bus is fully procedural (`src/vehicle/busModel.ts`): a side-profile loop swept across
the width with rounded corners (roof / front / rear / windshield / rear glass), side panels built
from `ShapeGeometry` with real window holes and wheel arches, a hollow cabin with interior lining,
dashboard, live canvas speedometer, steering wheel (rotates with input), gear lever, seats, grab
poles and instanced passenger silhouettes (count = passengers aboard). Glass is transparent
(`opacity 0.18`, `depthWrite false`, `DoubleSide`, env-map reflections).

Livery is painted on canvas in `src/vehicle/livery.ts` (bands, flowers, birds, hand-lettered
"চাঁদা পরিবহন" on both sides and the rear, "কুষ্টিয়া → ঢাকা" destination board). Text is drawn only
after `document.fonts.load()` resolves for the self-hosted Hind Siliguri font; `verifyBanglaShaping()`
sanity-checks that conjuncts and the chandrabindu shaped correctly.

### Optional GLB (`public/assets/bus.glb`)

`loadBus()` tries `/assets/bus.glb` first and falls back to the procedural bus if it is missing or
lacks the required nodes. Required / optional node names:

| Node             | Required | Notes                                                    |
|------------------|----------|----------------------------------------------------------|
| `body`           | yes      | Everything that rolls/pitches with the chassis           |
| `wheel_FL`, `wheel_FR` | yes | Front wheels; re-parented under steer + spin groups     |
| `wheel_RL`, `wheel_RR` | yes | Rear wheels; spin only                                  |
| `steering_wheel` | no       | Rotated about its local Z with steering                  |
| `door`           | no       | Rotated about Y when the door opens at a stop            |

Conventions: metres, Y up, bus forward = **−Z**, origin on the ground under the centre of mass,
wheel radius ≈ 0.5 m, front axle at z = −3.2, rear at z = +2.8 (`PHYSICS.lf` / `lr`). Mesh names
containing `light`/`lamp` with an emissive material are brightened at night / on braking. The GLB
rig has no interior passenger instances or canvas speedometer.

## Testing

`npm test` starts Vite and runs Playwright (headless Chromium with SwiftShader WebGL):

* **cockpit glass** — renders the cockpit view and reads back the windshield pixel block
  (`__game.renderAndRead`); fails if > 35 % of pixels are near-black. Also raycasts from the eye
  (`__game.cockpitClearance`) to make sure the camera is never inside opaque geometry.
* **screenshots** — chase, both sides (livery text), front, rear, rain, night → `test-results/screenshots/`.
* **physics** — runs 45 s of fixed-step simulation on the bridge straight with autopilot and asserts
  0–60 in 8.5–11.5 s and top speed 115–126 km/h.
* **route** — stop at Rajbari (passenger exchange), blockade hold → police → cleared, finish → results card.
* **performance** — the loop never stalls (frame < 1 s even under software rendering).
* **phase 2** (`tests/phase2.spec.ts`) — crowd close-up (20–28 humanoids, ≥12 variants, 400–1400 tris each, police 4–6),
  driver IK (hand-to-rim error < 6 cm) + glass still transparent, steering schemes + settings persistence across reload,
  minimap/full map/fork signboards + wrong-branch warning and recovery, landing + intro frames at 3/10/16/21/26 s with
  skip at every second, medium-tier draw-call budget and unchanged speed targets.
* **phase 3** (`tests/phase3.spec.ts`) — career save/XP/level across reload, garage purchases changing braking
  and acceleration + livery persistence, contracts met/missed, damage thresholds + repair + reset, level
  crossing/accident/toll, ferry crossing, roof load + checkpoint.
* **phase 2 gameplay** (same file) — Faridpur dwell with fares (+8 × ৳220) and the alms prompt,
  chada refuse (bus held, then released) and pay (−৳200), checkpoint speeding fine + hold vs. slow
  wave-through, speed camera fine, fuel burn + pump refuel + ledger on the results card, traffic mix
  (rickshaw/van present) and overtaking.

`window.__game` exposes `simulate(seconds, input)`, `teleport(s)`, `stats()`, `switchCamera(mode)`,
`toggleWeather()`, `applyWeather(kind)`, `forceSpecial(id)`, `openPhoto()`, `toggleHighBeam()`, `toggleRadio()`, `riders.force(kind)`, `startStory(day)`, `signals.force(i, state)`, `cattle.force(i)`, `setFreeCamera(pos, look)` for ad-hoc checks in the console.

## Phase 2 — money, incidents and fuel

The run is now a small economy. The HUD money pill shows the **net** (`game/ledger.ts`:
fares + tips − fines − chada − fuel − charity) and the results card breaks it down.

* **Stops at every town** (`WORLD.stops`): Rajbari, Faridpur, Bhanga and the Gabtoli terminal each
  have a yellow zone, a shed with a name board and waiting humanoids. Stop in the zone → the door
  opens, `getOff` passengers walk to the shed, up to `waiting` board (× 1.5 in the 7–10 am rush,
  × 0.5 at night, capped by free seats) and the helper collects `fare` per head. Driving past a
  zone marks the stop missed (mood penalty, shouts). The minimap ticks stops off as ✅.
* **Chada** (`WORLD.chadaSpots`, `game/incidents.ts`): a man under an umbrella waves the bus down.
  Stop near him and a two-button prompt (`#choice`, keys 1/2) asks for ৳200. Pay → ledger.chada;
  refuse → he stands in front of the bus for 8 s (physics wall), mood drains and the checkpoint
  later "gets a complaint". Driving past without stopping has a 50 % chance of the same complaint.
* **Police checkpoint** (`WORLD.checkpointS`): drums, a striped boom and two officers. Approach under
  30 km/h with no complaint → the boom lifts and you are waved through. Over the limit in the last
  25 m, or with a complaint → the boom stays down, the bus is held 12 s and fined ৳500.
* **Speed camera** on the bridge (`WORLD.speedCameraS`, limit 80 km/h): flash + ৳300.
* **Alms at Faridpur**: during the dwell a person (a beggar or a member of the hijra community —
  written respectfully, no caricature) walks to the door and asks for ৳10; give (charity, +mood) or
  decline politely.
* **Fuel** (`game/fuel.ts`): the tank starts 30–38 % full (the owner never fills it); burn scales
  with throttle × rpm (`GAMEPLAY.fuelBurnPerSec`, arcade-scaled so a hard-driven 6 km run uses
  ~20 % of the tank). A filling station sits in a lay-by on the left before the Faridpur junction
  (`WORLD.pumpS`): stop on the green refuel zone painted on the left lane in front of it and pick 20 L, 40 L
  or a full tank (৳65/L). An empty tank
  cuts the engine; a jerrycan rescue costs ৳800 and 20 s.
* **Traffic**: cycle-rickshaws and goods vans crawl in the kerb lane; cars, autos and bikes overtake
  slow leaders when the oncoming lane is clear (`overtake`), and CNG autos cut in ahead of a moving
  bus (`cutin`). Everything is still a collision circle — hitting it is still a crash.
* **Time of day** (real clock, re-read every minute): morning rush multiplies waiting passengers,
  night halves them, adds fog and lights lamps/headlights; the pre-trip card says which applies.

Tuning: `GAMEPLAY` in `src/config.ts` (`chadaAmount`, `checkpointFine`, `cameraFine`,
`fuelPricePerLitre`, `fuelPumpLitres`, `emptyTankRescue*`, rush hours) and `WORLD.stops`.
`__game.stats()` reports `ledger`, `chada[]`, `checkpoint`, `fuel`, `stops[]` and `choiceOpen`
for scripted checks; `scripts/probe-phase2.mjs` walks every incident with screenshots.

## Phase 3 — career, garage, contracts, damage and more road

* **Career profile** (`game/career.ts`, localStorage `cp-career`): every trip's net income goes into the
  driver's **balance**; XP (stars, passengers, stops served, minus fines and hard braking) drives seven
  levels with titles (হেল্পার → লিজেন্ড). The results card shows the delta and level-ups; the landing page
  shows a career chip with the XP bar.
* **Garage** (`game/garage.ts`, from the main menu or the pause menu): brakes (3 levels, +12 % each),
  engine (3 levels, +8 % torque), tyres (3 levels, +6 % grip), an air horn, and five paint schemes that
  repaint the livery bands and name board (`BusRig.setLivery`). Upgrades are physics multipliers in
  `vehicle/physics.ts` `MODS`, applied before every run.
* **Daily contracts** (`game/contracts.ts`): three offers per calendar day on the pre-trip card, filtered
  by level (on time, passenger service, safe driver, full load, honest driver, fuel saver, express,
  perfect trip). A met contract pays a bonus + XP at Dhaka; the results card says which.
* **Damage** (`game/damage.ts`): crashes add damage by impact speed (`GAMEPLAY.damagePerImpactMs`).
  ≥30 % the left headlight dies, ≥50 % the bumper bends and brakes/engine weaken with an 85 km/h cap,
  ≥75 % engine smoke, 55 km/h cap and frightened passengers, 100 % limp mode at 20 km/h. Cockpit view
  gets a cracked-windscreen overlay. Repair (`repairCostPerPercent` × damage) is charged at Dhaka.
* **New road events** (`world/eventProps.ts` + `game/incidents.ts`):
  * **Railway crossing** (`WORLD.railS`): gates drop with blinking signals when the bus is 110–170 m out,
    a loco + five coaches cross on real rails, the gates lift once it has passed (hard wall meanwhile).
  * **Accident scene** (`WORLD.accidentS`): an overturned truck, tape, a police officer, onlookers and an
    ambulance block the left lane. Wait 25 s stopped within 70 m and a wrecker pulls it onto the shoulder;
    or pass carefully in the oncoming lane (oncoming traffic queues/squeezes as usual). Same-direction
    traffic queues behind the lane barrier (`Traffic.laneBarrierS`).
  * **Toll plaza** (`WORLD.tollS`, lanes widen around a booth island): stop at the boom and choose — pay
    ৳1,500 (the helper hands it over) or dodge; dodging has a 60 % chance of a ৳3,000 camera fine and a
    complaint at later checks.
  * **Ferry** at the end of the wrong branch (Daulatdia ghat): cross for ৳1,200 and a 90 s wait, landing on
    the Dhaka highway (skips the checkpoint, blockade and toll; Faridpur/Bhanga passengers are lost), or
    turn back.
  * **Roof passengers** at Rajbari: the helper offers eight roof seats (+৳2,400). The bus loses 10 % grip
    and is capped at 90 km/h, roof riders shout above 60 km/h, and the checkpoint fines ৳1,000 and makes
    them get down.
* Ledger adds `repair` and `toll` (ferry money counts as toll); the results card lists both.

Tuning: `GAMEPLAY` (`tollAmount`, `tollDodgeFine`, `accidentWaitSec`, `ferryCost`, `ferryWaitSec`,
`roofSeats`, `roofFare`, `roofFine`, `roofSpeedCapKmh`, `damagePerImpactMs`, `repairCostPerPercent`),
`WORLD` (`tollS`, `railS`, `accidentS`), `LEVEL_XP` / `UPGRADES` / `LIVERIES` in `game/career.ts`,
`CONTRACTS` in `game/contracts.ts`. Probes: `scripts/probe-career.mjs`, `probe-garage.mjs`,
`probe-contracts.mjs`, `probe-damage.mjs`, `probe-events.mjs`, `probe-ferry-roof.mjs`.
Tests: `tests/phase3.spec.ts` (career, garage, contracts, damage, the three event groups).

## Phase 4 — records, PWA, a second route, a clear windscreen

* **HUD layout**: nothing is drawn over the road ahead any more. Messages, stop/checkpoint banners
  and toasts stack in a right-hand column under the top strip, passenger speech bubbles sit under
  the minimap on the left, the choice prompt is at the right (above the pedals on phones).
* **Badges** (`game/achievements.ts`): 18 achievements checked at the finish (first trip, five stars,
  no fines, honest, brave, full load, ferry, night owl, express, smooth, spotless, all stops, roof
  master, ten trips, hundred passengers, ওস্তাদ, contractor, rich). New unlocks appear on the results
  card; the **রেকর্ড** panel (main menu / pause) lists them with a **সেরা ট্রিপ** tab — the ten best runs
  by net income, the latest highlighted, and the results card says where the run ranked.
* **PWA**: `vite-plugin-pwa` precaches the build, so the game installs to a phone's home screen and
  boots offline (verified with `scripts/probe-pwa.mjs` against `vite preview`). PNG + maskable icons
  are rendered from `public/icon.svg` by `scripts/make-icons.mjs`; the main menu shows
  **📲 ফোনে ইনস্টল করুন** when the browser offers an install prompt.
* **Routes** (`src/routes.ts`): the world is data-driven. A `RouteDef` carries the road geometry, the
  wrong-turn branch, every event distance (`WORLD` numbers), stops, junction directions, signposts,
  town clusters, map waypoints, scenery ranges and the Bangla names used in messages (bridge, ghat,
  gates, toll sign…). `applyRoute()` copies the chosen route into `WORLD`/`ROUTE` before the world is
  built; the pre-trip card lists the routes and switching one reloads the page. ঢাকা → চট্টগ্রাম
  arrived in Phase 5. **ঢাকা → সিলেট** adds
  the Meghna bridge with its toll plaza and camera, a level crossing near Dhaka, the Narsingdi and
  Sayestaganj junctions, an accident after Sayestaganj, the blockade before the hills, **haor**
  wetlands (water on both sides, dykes, boats) after the bridge and **tea-garden hills** (rows of
  bushes on mounds, shade trees) around Sreemangal (`world/scenery.ts`). The sky box now follows the
  bus so long routes never leave it.

Probes: `scripts/probe-records.mjs`, `probe-pwa.mjs`, `probe-route.mjs <route-id>`, `probe-hud.mjs`.
Tests: `tests/phase4.spec.ts` (records, PWA manifest, Sylhet world + route switching).

## Phase 5 — Chattogram, weather, special passengers, sound, photo mode

* **ঢাকা → চট্টগ্রাম** (`src/routes.ts`): Kanchpur, the Meghna–Gumti bridge with toll plaza and
  camera, Comilla, a Chandpur-ghat wrong turn with its own ferry, a checkpoint and blockade, bare
  **hills** around Sitakunda and the **sea** on the right for the last stretch (beach, ships) before
  Alankar and the Chattogram gate (`world/scenery.ts` `hills` / `sea` ranges).
* **Weather** (`world/weather.ts`, `world/sky.ts`): each pre-trip rolls **clear / rain / fog / storm**
  (fog is likelier at night and dawn; `?weather=fog` etc. forces one) and prints a forecast line on the
  card plus a toast at departure. Fog brings an overcast dome, dense grey fog (~250 m view), a dim sun and
  headlights; storm darkens the sky, rains harder, and strikes **lightning** every 5–16 s (scene flash
  + screen flash, then a synthesised thunder roll). Rain and storm share the slippery-road grip. The
  🌧️ button / `R` cycles the four kinds.
* **Special passengers** (`game/specials.ts`): after a stop, one of six named riders may board with a
  request for the leg to the next stop — দাদি (no hard brakes), the exam student (be quick), রোগীর
  সাথে ভাবি (quick but gentle), the businessman (few horns, no fines), the mother with a baby (no horn,
  no hard brake), the photographer (stay under 65 km/h). They greet in a speech bubble, the goal sits in
  a purple pill under the minimap, and at the next stop they thank you with a **tip** (ledger row on the
  results card, 💝 badge) or grumble and the bus's mood drops. At most two per run, 65 % chance each;
  `__game.forceSpecial(id)` for tests.
* **Sound** (`vehicle/audio.ts`): ambience layers mixed from where the bus is — crowd murmur at bus
  stands and the blockade, the **rail bell** while the gates are down, the **train** rumble and horn by
  distance, a **police siren** sweep, river water on the bridges and the ghat branch — and melodic
  stings for tips (cash), fines / an unhappy rider (fail), tolls (ding), new badges / a met contract
  (badge) and a level-up fanfare. Everything is still synthesised; gains live in `AUDIO`.
* **Photo mode** (`game/photo.ts`): from the pause menu (📸) or `F` while driving. The game pauses, every
  HUD layer hides and the camera orbits the bus (drag / wheel / pinch). **ছবি সেভ** renders a clean frame,
  stamps "চাঁদা পরিবহন · route · time" and shares it (Web Share with files on phones) or downloads a PNG.
  `Esc` / ✕ returns to where you came from.
* **Fix**: the toast column was outside the right-hand stack and overlapped the top HUD pills.

Probes: `scripts/probe-weather.mjs`, `probe-specials.mjs`, `probe-audio.mjs`, `probe-photo.mjs`.
Tests: `tests/phase5.spec.ts` (Chattogram route, weather, special passengers, audio layers, photo mode).

## Phase 6 — daily challenge, minibus, night hazards, traffic signals

* **আজকের চ্যালেঞ্জ** (`game/challenge.ts`): a PRNG seeded with the date picks the route, clock hour,
  weather and contract, so everyone drives the same run that day. The main-menu panel shows today's
  conditions, your best and the last days' scores; **খেলুন** switches route if needed (reload) and
  the pre-trip card locks everything. Score = net income + stars × 500 + contract bonus; the best per
  day is kept in `localStorage` (`cp-challenge`) and the results card has a share button (Web Share /
  clipboard). `?challenge=1` or `?challenge=YYYY-MM-DD` boots straight into one.
* **Minibus** (`BUSES` in `game/career.ts`): the garage sells an 8 m minibus (24 seats, 62 % mass,
  shorter axles, 105 km/h cap, quicker off the line). The procedural bus model now takes dimensions
  per build (window bays, seat rows and axles follow the body), and the physics reads bus multipliers
  from `MODS` (mass, busTorque, busGrip, busCapKmh). Switching buses reloads the page.
* **Night hazards**: about 30 % of trucks, vans, rickshaws and autos run without lamps at night (dark
  instance colour, no glow — lit vehicles get instanced head/tail lamps); `L` / 🔦 toggles the bus's
  **high beam** (longer, brighter cones; oncoming lit traffic flashes back). At village spots a herder
  walks three cows across the road when the bus is 220 m out (`world/cattle.ts`); cows are solid, a
  hit shoves the cow aside and costs ৳2,000 compensation plus mood.
* **Traffic signals** (`world/signals.ts`): three town junctions per route get a signal pole with an
  arm, a three-lamp head, a stop line and a zebra crossing, cycling green 14 s → amber 3 s → red 12 s
  with per-signal offsets. Crossing the line on red costs ৳800 (traffic police) and mood; a clean stop
  on red is praised. AI traffic in the bus's direction queues at red/amber lines.
* Route data gained `cattleS` and `signalsS`; the pre-trip hint paragraph is built from the route.

Probes: `scripts/probe-challenge.mjs`, `probe-minibus.mjs`, `probe-night.mjs`, `probe-signals.mjs`.
Tests: `tests/phase6.spec.ts` (daily challenge, minibus, night hazards, traffic signals).

## Phase 7 — story mode, radio, passenger moments, street life

* **স্টোরি: ৭ দিনের চাকরি** (`game/story.ts`): seven linked days for a bus owner. Each day fixes the
  route, clock, weather and contract and adds a condition — Eid crowd (×1.8 at the stands), hartal
  (half the passengers), a ৳5,000 loan instalment, a storm night, an inspector on board (clean trip →
  ৳1,500 bonus, else ৳2,000 off), a foggy finale — with a net-income target. The main-menu panel shows
  the owner's line and the day cards; the pre-trip card locks the day; the results card judges it
  (target 1 pt, 4+ stars ½, no fines ½) and chains to the next day. After day 7 the owner's verdict
  is one of three endings. Progress in `localStorage` (`cp-story`); `?story=N` boots a day.
* **Radio** (`game/radio.ts`): 📻 / `N` cycles three fictional stations — a pentatonic folk tune, a
  minor-key pop loop and a news station with a time signal — all synthesised by a small WebAudio
  step sequencer. A ticker in the right-hand column carries traffic (route-aware), weather (the real
  kind), adverts and news. The station is remembered in settings; the radio ducks under the horn.
* **Passenger interaction 2.0** (`game/riders.ts`): a haggle at boarding (accept −20 %, refuse — some
  walk away, or let the helper argue), a big note with no change mid-leg (helper fetches change at
  the next stop → +15 s dwell, waive, or helper), and a mid-way drop request (stop within 20 s for a
  ৳20 tip, or refuse). At most one haggle per stop and one event per leg; `riders.force(kind)`.
* **Street life** (`world/streetlife.ts`): scenes that exist only in their hour band — school children
  at every stand 07:00–09:30, haat stalls with sellers and shoppers 11:00–14:00, a cricket pitch
  with players 16:00–18:30, lit tea stalls with people on the bench 19:00–23:30. People join the
  animation manager only while their scene is on.
* Stop dwell can be extended by events (`events.extraDwell`); ledger gained an `owner` row.

Probes: `scripts/probe-story.mjs`, `probe-radio.mjs`, `probe-riders.mjs`, `probe-street.mjs`.
Tests: `tests/phase7.spec.ts` (story mode, radio, passenger interaction, street life).

## Phase 8 — graphics

Everything is still procedural (no art assets); the aim was "clean, bright, stylised" with a real
depth and material response, inside the phone budget. By quality tier:

| | low | medium | high |
|---|---|---|---|
| post-processing (`render/post.ts`, opt-in via settings) | none | bloom (after tone mapping) → grade + vignette → SMAA | + GTAO, heat haze with `?haze=1` |
| shadows | none | one 1024 sun map | three cascades, 2048 (`render/shadows.ts`, `?csm=0` to compare) |
| rear-view mirror | — | live | live |

* **Materials**: asphalt normal map from a procedural height field (grain, patches, cracks) next to
  the roughness map; grass blades + clump normals; ~5,600 instanced roadside tufts; ~220 reflective
  puddles that fade in with wetness. Bus: rivet strips, mud flaps with mud, a dirt skirt, tarp and
  rope over the luggage, more reflective glass.
* **Lighting**: cascaded shadows on high; sun rays sprite at dawn/dusk; warm light pools under the
  street lamps and emissive bulbs at the tea stalls (no real point lights — one scene point light
  makes every material pay for it); additive headlight cones at night and in fog, longer on high beam.
* **Scenery**: tree cards painted as lit leaf clusters with sky gaps and a wind-sway vertex shader;
  a far-horizon ring of hills and village silhouettes; birds wheeling ahead by day and kites in the
  late afternoon; pitched tin roofs on every third shop.
* **Particles** (`world/particles.ts`, one draw call): exhaust by throttle, dust off the shoulder,
  wheel spray in rain, tea-stall smoke. Cockpit rain on the glass with wiper wedges
  (`vehicle/glassRain.ts`).
* **Performance notes**: the HUD lost its backdrop blur, the sky environment map bakes once per
  frame at most, static meshes of signals/cows/stalls are merged, instanced meshes are left out of
  the merge. Draw calls are counted across every post pass (`stats().drawCalls`).

* **Smoothness and clarity pass** (after play-testing on phones): post-processing is now opt-in
  (settings → ইফেক্ট; `?post=basic|full` still forces it), pixel ratio is capped at 1 / 1.25 / 1.5 by
  tier, bloom is much weaker with a high threshold so night frames stay crisp, the headlight spots
  are dimmer with a steeper falloff and the volumetric cones only appear in fog or storm (the white
  wash in front of the bus at night came from spot + cone + bloom stacking), and a watchdog drops to
  the low tier after 12 s under 28 fps (unless `?quality=` was given).
* **Traffic never rams the bus**: the bus is a lead vehicle for same-direction traffic whenever it is
  on the main road (parked at the start too), the lateral test uses each vehicle's real position and
  width, closing on the bus within 55 m triggers a hard brake, overtakers do not abort alongside the
  bus, and recycled/wrapped vehicles never land in the 200 m behind or 120 m ahead of it (nor at full
  speed behind it). Cars, bikes and buses overtake a stopped bus when the other lane is clear;
  trucks, rickshaws and vans queue behind. A touch from behind no longer counts as a crash or damage
  (`stats().rearHits`).

Probes: `scripts/probe-post.mjs`, `probe-ground.mjs`, `probe-light.mjs`, `probe-bus.mjs`,
`probe-scenery.mjs`, `probe-particles.mjs`, `probe-calls.mjs <port>`, `probe-traffic-ram.mjs`.
Tests: `tests/phase8.spec.ts` (post levels and frame luma, lighting, bus detail, particles, UI,
traffic no-ram).

## Extension points

`game/events.ts` is a small state machine keyed on route distance — add stops / events there.
`world/props.ts` clusters, `world/road.ts` `ROUTE` segments and `passengers.ts` `LINES` are data.
`vehicle/audio.ts` `EngineSource` interface lets recorded samples replace the synth. Incidents are
independent classes (`game/incidents.ts`, `game/fuel.ts`) that read route distance and speed and talk
to the HUD, ledger and the choice panel — a new event is one more `updateX()` there plus its props in
`world/incidentProps.ts`.

All names are fictional; no real companies, parties or politicians.
