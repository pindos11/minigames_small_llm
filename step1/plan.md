# Space Shooter — Architecture & Implementation Plan

## 0. Status: Phase 2 Complete (Steps 1-6)

**Phase 2** transformed the WASD+mouse demo into a fully playable space shooter:

- **Entity pools** — generic `createPool()` factory with Bullet/Enemy/Pickup pools, off-screen culling
- **Shooting** — click/touch to fire, with cooldown, multishot, rapidfire, and damage upgrades
- **Collision** — circle-vs-circle for all entity pairs (bullet↔enemy, bullet↔obstacle, ship↔obstacle, ship↔enemy, ship↔pickup)
- **Enemies** — 3 types (basic/fast/tank) with tracking AI, HP bars for tanks
- **Waves** — 3 spawn patterns (circle/line/scatter), escalating difficulty, staggered spawning
- **Obstacles** — 15 procedurally-generated asteroids with rotation, collision with bullets and ship
- **Pickups** — health orbs and upgrade gems with magnet effect and pulse animation
- **FX** — particle bursts, screen shake, engine thrust glow, death explosions
- **HUD** — health bar (CSS), score, wave counter, upgrade tags, game-over overlay with restart
- **Touch controls** — virtual joystick (left) + auto-fire zone (right)
- **Game states** — PLAYING / GAME_OVER with full reset support

---

## 1. What `step1/index.html` Already Has

| Module | What exists | What's missing |
|---|---|---|
| **Vector math** | `V2`: add/sub/scale/len/norm/lerp/dist | None |
| **WebGL2 pipeline** | One shader program, 5 vertex attributes, VAO, and `Draw` batches for filled rectangles, circles, and triangles; batch size increased to 16384 verts | No textures, alpha blending, depth testing, or batch-overflow handling |
| **Camera** | Smooth player follow; Y-up world-to-screen and screen-to-world transforms; wheel zoom clamped to 0.2-5.0; screen shake via FX module | Zoom is viewport-centered, not cursor-centered |
| **Input** | Keyboard movement, mouse position/world position, mouse button/click flags; mouse world position refreshed after camera movement; **touch controls: virtual joystick (left half) + auto-fire zone (right half)**; click triggers shooting | None |
| **Player** | Green triangular ship with yellow nose marker; WASD/arrow movement, acceleration, friction, mouse aiming; **10 HP with invincibility blink on hit; shooting with cooldown; engine thrust glow; composable upgrade system with upgrades[] array; multishot/rapidfire/damage/curved_bullets; death state** | None |
| **Stars** | 300 bright gray polygonal stars, rendered in one batch; subtle parallax offset matching camera movement | None |
| **Game loop** | Delta-time update, FPS/position status text, star render pass, player render pass; **full game state machine (PLAYING/GAME_OVER); entity render ordering (stars→obstacles→FX→pickups→enemies→bullets→player); touch joystick visual overlay; composable upgrade onBulletTick hooks** | None |

The file uses several global module objects (`V2`, `Draw`, `Camera`, `Input`, `Player`, and `Game`) in one script; it does not use one shared global state object.

---

## 1. System Architecture — Modules / Objects

```
step1/index.html
├── V2                          (already exists — vector math)
├── Draw                        (already exists — batched WebGL renderer)
├── Camera                      (already exists — smooth follow)
│
├── Input                       ✓ EXTENDED: touch joystick + auto-fire + shooting trigger
├── Player                      ✓ EXTENDED: health, shoot(), upgrade stats (multishot/rapidfire/damage)
├── Entity                      ✓ NEW: pool factory + spawn/update/forEach/cleanup pattern
│   ├── Enemy                   ✓ EnemyPool — tracks player, 3 types (basic/fast/tank)
│   ├── Bullet                  ✓ BulletPool — projectile entities
│   ├── Pickup                  ✓ PickupPool — health/upgrade drops with magnet effect
│   └── Obstacle                ✓ Asteroids — procedurally-generated jagged circles
│
├── EntityManager               ✓ Merged into pool factory pattern (no separate mgr)
├── Collision                   ✓ Circle-vs-circle: bullet↔enemy, bullet↔obstacle,
│                              ship↔obstacle (push-back + damage), ship↔enemy, ship↔pickup
├── UpgradePool                 ✓ multishot / rapidfire / damage_amp / curved_bullets (with bulletMod/onBulletTick)
├── Level                       ✓ Wave system — 3 spawn patterns (circle/line/scatter),
│                              escalating difficulty, staggered spawn queue
├── FX                          ✓ Particle bursts (death/explosion/impact), screen shake
├── Game                        ✓ Extended: state machine (PLAYING/GAME_OVER), full render pass
└── UI                          ✓ HUD: health bar, score, wave counter, upgrade tags, game-over overlay
```

### Key design decisions

- **Entity pool pattern** — pre-allocate typed arrays for bullets/enemies/pickups; "alive" flag instead of push/pop. Keeps GC silent under pressure.
- **Component-like upgrades** — each upgrade is a small function object that mutates `Player` and/or returns a bullet modifier function. No switch/if-else chains on upgrade type.
- **Single-pass game loop** — `update(dt)` then `render()` — no entity component system overhead needed for a 2D shooter.

---

## 2. Upgrade System Design — Composable & Extensible

### Core idea

Upgrades are **first-class function objects** that compose into pipelines. No enum-to-function switch chains. Adding a new upgrade is: write a function, register it.

### Type definitions (conceptual)

```
// An Upgrade is a config object:
type Upgrade = {
  name: string;
  icon?: string;
  
  // Called once when player picks up this upgrade
  apply(player: Player): void;
  
  // (optional) Returns a bullet modifier function applied per shot
  bulletMod?: (baseBullet: BulletSpec) => BulletSpec;
  
  // (optional) Called every frame on the player
  onUpdate?: (player: Player, dt: number) => void;
  
  // (optional) Called every frame on each bullet in flight
  onBulletTick?: (bullet: Bullet, dt: number) => void;
  
  // (optional) Called when player takes damage
  onHit?: (player: Player, damage: number) => number; // return reduced damage
  
  // (optional) Called when bullet hits something
  onBulletHit?: (bullet: Bullet, target: Entity) => void;
};
```

### Composition mechanism

The `Player` holds an `upgrades: Upgrade[]` array. Each subsystem queries it:

```
Player.update(dt):
  for each upgrade in upgrades:
    if upgrade.onUpdate: upgrade.onUpdate(this, dt)

Player.shoot():
  baseBullet = { x, y, angle, speed, damage, ... }
  for each upgrade in upgrades:
    if upgrade.bulletMod:
      baseBullet = upgrade.bulletMod(baseBullet)
  spawnBullet(baseBullet)

Bullet.tick(dt):
  for each upgrade in player.upgrades:
    if upgrade.onBulletTick: upgrade.onBulletTick(this, dt)

Bullet.collision(target):
  for each upgrade in player.upgrades:
    if upgrade.onBulletHit: upgrade.onBulletHit(this, target)
```

### Existing upgrades (in step1)

Four upgrades are registered and functional with composable pipeline:
- **multishot** — adds extra bullets per shot (stat: `Player.multishot`, bulletMod: angle spread)
- **rapidfire** — reduces shoot cooldown (stat: `Player.rapidFireLevel`)
- **damage_amp** — increases bullet damage per level (stat: `Player.damageLevel`)
- **curved_bullets** — steers bullets left each tick via `onBulletTick` (bulletMod: sets curved flag, onBulletTick: rotates velocity perpendicular to direction)

The composable `bulletMod`/`onBulletTick` pipeline is now active — upgrades register hook functions that are called during bullet spawn and per-frame update.

### Planned upgrades (extensible set)

| Upgrade name | `apply` effect | `bulletMod` | `onBulletTick` | `onBulletHit` |
|---|---|---|---|---|
| **multishot** | none | angle spread → N bullets | — | — |
| **curved_bullets** | none | stores originalAngle | rotates velocity each tick | — |
| **piercing** | none | piercing: true | — | doesn't destroy bullet on hit |
| **homing_bullets** | none | homing: true, targetRadius | steers toward nearest enemy | — |
| **rapidfire** | reduces shootCooldown | — | — | — |
| **damage_amp** | increases baseDamage | — | — | — |
| **shield** | adds shieldHP | — | — | `onHit` absorbs damage |
| **trail_fx** | none | trailParticles: N | — | spawns trail on bullet |
| **explosive** | none | explosionRadius: R | — | spawns AoE on hit |
| **drone** | spawns companion drone entity | — | drone.update(dt) | drone shoots |

### Adding a new upgrade (example)

```js
const curvedBullets = {
  name: 'curved_bullets',
  apply(player) { /* no player-side effect */ },
  bulletMod(bullet) {
    return { ...bullet, curved: true, curvature: 1.5 };
  },
  onBulletTick(bullet, dt) {
    if (bullet.curved) {
      const [cx, cy] = V2.norm([bullet.vx, bullet.vy]);
      const perp = [-cy, cx];  // 90° left
      bullet.vx += perp[0] * bullet.curvature * dt;
      bullet.vy += perp[1] * bullet.curvature * dt;
      // renormalize to keep speed constant
      const s = V2.len([bullet.vx, bullet.vy]);
      bullet.vx = bullet.vx / s * bullet.speed;
      bullet.vy = bullet.vy / s * bullet.speed;
      bullet.angle = Math.atan2(bullet.vy, bullet.vx);
    }
  },
};
```

Register once: `UpgradePool[curvedBullets.name] = curvedBullets;`
Pickup calls: `player.upgrades.push(UpgradePool[name]);`

**That's it.** No switch, no enum, no refactoring existing code.

---

## 3. Implementation Plan (7 Steps)

Each step builds on the previous one. All in the same `index.html` file.

---

### Step 1: Entity Base + Pool + EntityManager ✓ **DONE**

**Goal:** Generic entity system to hold bullets, enemies, pickups, obstacles.

**What was added:**
- `createPool(max)` factory — generic typed pool with `spawn()`, `update(dt, cullDist)`, `forEach(fn)`, `cleanup()`
- Typed pools: `BulletPool` (500), `EnemyPool` (100), `PickupPool` (30)
- Pre-allocated `Float32Array`-backed entities with `alive` flag instead of push/pop
- Off-screen culling at 900 world units from camera
- Entity rendering integrated into `Game.loop` render passes

**Verification:** Bullets/enemies/pickups spawn, move with velocity, render as circles, get culled when far away.

---

### Step 2: Input Extension + Player Shooting + Collision ✓ **DONE**

**Goal:** Player shoots bullets; bullets collide with enemies.

**What was added:**
- **Input:** Left-click → shoot trigger; touch → virtual joystick (left half of screen, drag to move) + auto-fire zone (right half, hold to fire)
- **Player:** `shootCooldown` (0.2s base), `shoot()`, `health` (10), `maxHealth` (10), invincibility blink on hit, engine thrust glow
- **Bullet pool:** Spawns bullets from player position at aim angle with configurable speed
- **Collision module:** Circle-vs-circle for bullet↔enemy (damage + destroy bullet), ship↔obstacle (push-back + bounce + damage), ship↔enemy (push-back + damage), ship↔pickup (collect)
- **Enemy AI:** Enemies follow player's current position with `V2.norm()` — simple tracking
- **3 enemy types:** basic (80 speed, 1 HP), fast (150 speed, 1 HP), tank (50 speed, 3 HP with health bar)

**Verification:** Click to shoot → bullets fly → hit enemies → enemies die with particle burst + score. Enemies track player. Touch joystick + fire zone works.

---

### Step 3: Obstacles (Asteroids) + Collision with Projectiles ✓ **DONE**

**Goal:** Static obstacles that block ships and projectiles.

**What was added:**
- **Obstacle system:** 15 procedurally-generated asteroid circles (8-13 vertex irregular shapes), each with random radius (20-50), slow rotation, and slight color variation (gray-brown)
- **Level module:** `Obstacles.spawn(n)` — places N obstacles randomly, all with a minimum 300-unit distance from spawn zone (0,0)
- **Collision extension:** Bullet-vs-obstacle (destroys bullet, spawns spark particles); Ship-vs-obstacle (push-back, velocity reversal at 50%, takes 1 damage)
- **Obstacle rendering:** Irregular polygon circles using `Draw.triangle()` with locally-scaled vertex arrays, slow rotation animation

**Verification:** Bullets stop at asteroids with spark FX. Player bounces off with damage. Asteroids rotate and look like space rocks.

---

### Step 4: Enemy Waves + Death FX + Pickups ✓ **DONE**

**Goal:** Waves of enemies spawn in patterns; enemies drop pickups on death.

**What was added:**
- **Wave system:** `Level` module with `spawnWave()` — 3 patterns: circle, line, scatter. Spawn count scales as `3 + wave * 2`. Enemies spawn off-screen at ~700 units distance with staggered delays (0.25s each). Auto-triggers next wave 3s after queue empties.
- **Enemy types:** 3 types — basic (red, 80 spd, 1 HP, 10 pts), fast (orange, 150 spd, 1 HP, 20 pts), tank (dark red, 50 spd, 3 HP + health bar, 30 pts)
- **Death FX:** Particle burst in enemy color (18 particles, 0.6s lifetime) + screen shake (3px, 0.12s) on enemy death
- **Pickup pool:** 30% drop chance on enemy death. Two types: `health` (green orb, +3 HP) and `upgrade` (yellow gem, random from UpgradePool)
- **Pickup behavior:** Magnet effect — pickups within 120 units accelerate toward player; velocity damped at 0.95; pulse animation (20% size oscillation); auto-culled at 900 units
- **HUD overlay:** Health bar (gradient, CSS transition), score display, wave counter, active upgrade tags (multishot/rapidfire/damage with emoji icons), game-over overlay with score summary and restart button
- **Game-over state:** Player dies → freeze game loop → show overlay with score + wave → restart resets all systems

**Verification:** Waves spawn in patterns with increasing difficulty. Enemies die with burst FX and drop pickups. Pickups magnetize and auto-collect. HUD reflects current state.

---

### Step 5: Upgrade System (Core) + HUD ✓ **DONE**

**Goal:** Composable upgrade system + player-facing UI.

**What was added:**
- **`UpgradePool` object:** `multishot` (N-bullet spread), `rapidfire` (reduced cooldown), `damage_amp` (increased damage) — all registered as config objects with `apply(player)` methods
- **Player upgrade stats:** `multishot` (adds bullets per shot), `rapidFireLevel` (reduces cooldown), `damageLevel` (increases damage)
- **HUD overlay:** Health bar (CSS gradient with smooth transition), score display, wave counter, upgrade tags with emoji icons at bottom
- **Game states:** `PLAYING → GAME_OVER` (pause/restart on Escape via game-over overlay)
- **Death handling:** Invincibility blink, screen shake, particle burst, game-over screen with score + wave + restart button

**Verification:** Picking up an upgrade increments the stat and shows the tag in HUD. Multiple pickups stack. Game over screen appears on death with restart.

---

### Step 6: First Composable Upgrades ✓ **DONE (4 of 4)**

**Goal:** Implement 3-4 upgrades to prove the composable system works.

**What was implemented:**

```
1. ✓ multishot      — N-bullet spread (increases bullet count per shot)
2. ✓ rapidfire      — reduces shoot cooldown (increases fire rate)
3. ✓ damage_amp     — increases bullet damage (flat +1 per level)
4. ✓ curved_bullets — bullets curve left via onBulletTick steering
```

**Composable pipeline now active:**
- `Player.upgrades[]` array stores upgrade objects
- `Player.shoot()` applies `bulletMod` from each upgrade to the base bullet spec before spawning
- `BulletPool.forEach()` calls `onBulletTick` from each upgrade each frame
- Pickup collection pushes upgrade objects into `Player.upgrades[]`
- HUD counts upgrade instances by name

**Remaining:** `piercing`, `homing_bullets`, `trail_fx`, `explosive`, `drone` (reserved for Step 7).

---

### Step 7: Polish & Mobile Touch ⏳ **PARTIALLY DONE**

**Goal:** Complete the experience.

**What was added in Phase 2:**
- ✓ **Full touch controls:** Virtual joystick (left half) + auto-fire zone (right half) — fully functional
- ✓ **Camera shake** on player hit (FX.shake integrated into render)
- ✓ **Difficulty ramp:** Wave count and enemy speed scale with wave number
- ✓ **Score system** — tracks kills, displayed in HUD and game-over screen
- ✓ **Star field parallax** — subtle offset matching camera movement
- ✓ **Particle FX** — burst on death, impact sparks, pickup collection, engine thrust glow
- ✓ **Screen shake** on player damage
- ✓ **HUD overlay** — health bar, score, wave, upgrades, game-over screen

**Still TODO:**
- ⏳ Deeper parallax star layers (3 depth layers)
- ⏳ Background nebula / fog shader
- ⏳ Sound placeholders (Web Audio API oscillator beeps)
- ⏳ Survival time tracking
- ⏳ Screen transitions (fade in/out)
- ⏳ MENU state (before PLAYING)
- ⏳ Pause on Escape (RESUME state)
- ⏳ `curved_bullets` and other advanced upgrades (multishot/curved/piercing/homing/trail/explosive/drone)
- ⏳ Composable upgrade pipeline refactor (bulletMod/onBulletTick hook system)

---

## File Structure in `index.html` (final)

All in one file, in this order:

```
1.  Styles                        ✓ Phase 2: HUD CSS, game-over overlay, touch hints
2.  V2 (vector math)              ✓ exists (unchanged)
3.  WebGL2 + Draw (renderer)      ✓ exists, batch size increased to 16384 verts
4.  Camera                        ✓ exists (unchanged)
5.  Input                         ✓ extended: touch joystick + auto-fire + shooting trigger
6.  Stars                         ✓ exists (unchanged)
7.  Entity + Pools                ✓ Phase 2: createPool() factory pattern, Bullet/Enemy/Pickup pools
8.  FX / Particles                ✓ Phase 2: burst() particles, shake(), screen shake integration
9.  Obstacles                     ✓ Phase 2: asteroid generation, collision with bullets/ship
10. Enemy                        ✓ Phase 2: 3 types, tracking AI, HP bars, wave spawning
11. Level + Waves                ✓ Phase 2: 3 spawn patterns, escalating waves, staggered queue
12. UpgradePool                  ✓ Phase 2+6: multishot, rapidfire, damage_amp, curved_bullets (composable pipeline)
13. Player                       ✓ extended: health, shoot(), invincibility, upgrade stats
14. UI + HUD                     ✓ Phase 2: health bar, score, wave, upgrades, game-over overlay
15. Game (loop)                  ✓ extended: PLAYING/GAME_OVER states, full render pass, collision
```

---

## Extension Points (for future)

| To add | Where | Effort |
|---|---|---|
| New enemy type | New `EnemyType` object in `Level.js`, or just extend Enemy pool with different stats | Low |
| New upgrade | Add 1 object to `UpgradePool` with relevant hook(s) | Low |
| New bullet type | Add `bulletMod` or `onBulletTick` in any upgrade | Low |
| New obstacle type | Add to `ObstaclePool`, `Level.spawnObstacles()` | Medium |
| Power-up combo system | Extend `UpgradeSystem` with combo rules | Medium |
| Save/load upgrades | Add `localStorage` in `Game` init/quit | Low |
| Multiplayer | Not supported by this architecture; would need refactor | High |
