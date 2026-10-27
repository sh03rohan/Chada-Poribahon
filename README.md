# চাঁদা পরিবহন (Chada Poribohon) — Phase 1

A browser-based Bangladeshi bus-driving game. Vite + TypeScript + three.js, no framework.
Route: কুষ্টিয়া → রাজবাড়ী (stop) → ফরিদপুর (andolon) → পদ্মা → ঢাকা, ~6 km, left-hand traffic.

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

### Cities, roundabouts, weather, mobile

* **চত্বর / 4-way junctions** at Rajbari (2.13 km), Faridpur (3.56 km) and Dhaka (5.72 km): the main road widens
  (`Road.bulge`) and splits around a kerbed island with a monument, flower beds and lamps; two side roads leave
  left and right, and a 4-face direction sign on the island tells arriving traffic where each road goes
  (`DIRECTIONS` in `src/world/roundabouts.ts`). Traffic, pedestrians and the autopilot follow the widened lanes;
  the island is solid; the side roads count as road surface (`Roundabouts.onSideRoad`) but lead off-route.
* **Solid world** (`src/world/collision.ts`): every placed prop registers a collider circle (trees, poles, lamp
  posts, signs, shops, buildings as rows of circles, shed, gate and gantry posts, bridge railings, ferry-queue
  trucks, islands); traffic vehicles and the police van are added per step. The bus is 5 circles; penetrations
  are pushed out and the velocity into the obstacle removed, so it stops against things or slides along them.
  Impacts > 2 m/s cost mood (3–15), show a message and play a thump.
* **Ride**: no camera shake on tarmac and only a 2 mm road bounce (`CAMERA.shake*`, `PHYSICS.roughness*`) — the
  bus is meant to feel heavy and smooth; off-road keeps a mild shake.
* **Sky**: visible sun disc + glow, moon and stars at night (the dome goes properly dark, exposure 0.32), a cloud
  dome that thickens and darkens with rain, fog/light/exposure all re-derived on every time or weather change.
* **Mobile**: the first menu tap requests fullscreen + `screen.orientation.lock('landscape')` (Android); where
  locking is unsupported (iOS) a portrait overlay asks the player to rotate. `manifest.webmanifest` declares
  `orientation: landscape` for installed/PWA use.

### Traffic & people

Ambient traffic (cars, bikes with riders, buses, trucks, CNG autos) runs in both lanes. Following uses a
stopping-distance rule (fastest speed from which the vehicle can still slow to its leader within the gap at
4.5 m/s²), so vehicles queue behind the bus and the blockade instead of driving through it; oncoming vehicles
swerve to their shoulder and brake to a stop if the bus sits in their lane.
Rear-ending a vehicle stops the bus and costs mood. Pedestrians walk the footpaths, hawkers stand at shop
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
| medium | ≤1.5        | blob shadow only    | no    | 2600           | 75 %  |
| high   | ≤2.0        | PCF soft shadow map | yes   | 5000           | 100 % |

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

`window.__game` exposes `simulate(seconds, input)`, `teleport(s)`, `stats()`, `switchCamera(mode)`,
`toggleWeather()`, `setFreeCamera(pos, look)` for ad-hoc checks in the console.

## Extension points (Phase 2+)

`game/events.ts` is a small state machine keyed on route distance — add stops / events there.
`world/props.ts` clusters, `world/road.ts` `ROUTE` segments and `passengers.ts` `LINES` are data.
`vehicle/audio.ts` `EngineSource` interface lets recorded samples replace the synth. Traffic, fuel,
chada and other events are deliberately not in Phase 1.

All names are fictional; no real companies, parties or politicians.
